import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import { AgentClient } from '../agent-client/agent-client.service';
import { DrainService } from '../common/drain/drain.service';
import {
  type GateRefusal,
  OnboardingService,
} from '../consents/onboarding.service';
import { UserEmitter } from '../common/emitter/user-emitter.service';
import type { Environment } from '../config/env.schema';
import { MessagesService } from '../messages/messages.service';
import { MetricsService } from '../observability/metrics.service';
import { tracer } from '../observability/tracing';
import { SpanStatusCode } from '@opentelemetry/api';
import { RedisService } from '../redis/redis.service';
import type { L1Result } from '../safety/l1';
import { maxRisk, type RiskLevel } from '../safety/risk';
import { SafetyService } from '../safety/safety.service';
import { toAgentHistory } from '../sessions/history';
import { turnLockKey } from '../sessions/session-timers.service';
import { SessionsService } from '../sessions/sessions.service';
import { ConversationService } from './conversation.service';
import {
  DEFAULT_SESSION_LOCALE,
  SessionStateService,
  type SessionLocale,
} from './session-state.service';

/** 02 §9.1: messages are capped at 2,000 characters. */
export const MAX_MESSAGE_CHARS = 2000;

export const messageSendSchema = z.object({
  client_message_id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  content: z.string(),
});

export type SendAck =
  | {
      ok: true;
      client_message_id: string;
      message_id: string;
      duplicate: boolean;
      /** The session the message went to; a new room puts it in its URL right away. */
      session_id: string;
    }
  | {
      ok: false;
      code: string;
      message: string;
      /** Help information travels with every refusal that a person at risk could hit. */
      help?: { url: string; contacts: unknown[] };
    };

/** A crisis already established before the turn starts (L1, or L2 on the quota path). */
type Precheck = { crisis: true; layer: 'l1' | 'l2'; signals: string[] } | null;

const QUOTA_MESSAGE =
  'Kuota sesi DeepTalk AI bulan ini sudah terpakai semua. Terima kasih sudah meluangkan waktu untuk dirimu. Sambil menunggu kuota diperbarui, kamu tetap bisa melanjutkan Daily Routine, mengikuti asesmen, atau berbicara dengan psikolog DeepTalk.';

/**
 * Entry point for `message.send` (02 §6.2–§6.4). Ordering matters:
 *
 *  1. Validate, then **L1 first** — local and deterministic, before rate limits or quotas.
 *  2. Rate limit (a crisis message is never rate-limited).
 *  3. Gates before a new session (02 §9.2): age and, unless the beta trial bypass is enabled,
 *     service consent. A refused message is not
 *     stored; if L1 flags it `crisis`, the protocol is still sent (content-free audit + alert).
 *  4. Session: open or create. With the quota used up, the message still goes through L1 and
 *     L2; only a non-crisis message gets `quota.exhausted` — never a user at risk (02 §6.3).
 *  5. One turn per session (Redis lock), idempotent storage, `message.ack`, then the turn.
 */
@Injectable()
export class TurnService {
  private readonly logger = new Logger(TurnService.name);
  private readonly lockTtlMs: number;
  private readonly ratePerMinute: number;
  private readonly helpUrl: string;

  constructor(
    private readonly sessions: SessionsService,
    private readonly messages: MessagesService,
    private readonly conversation: ConversationService,
    private readonly state: SessionStateService,
    private readonly safety: SafetyService,
    private readonly agent: AgentClient,
    private readonly redis: RedisService,
    private readonly emitter: UserEmitter,
    private readonly metrics: MetricsService,
    private readonly drainService: DrainService,
    private readonly onboarding: OnboardingService,
    config: ConfigService<Environment, true>,
  ) {
    // Outlives the turn deadline, so a crashed instance's lock still expires on its own.
    this.lockTtlMs =
      config.get('AGENT_TURN_TIMEOUT_MS', { infer: true }) + 15_000;
    this.ratePerMinute = config.get('RATE_LIMIT_MESSAGES_PER_MINUTE', {
      infer: true,
    });
    this.helpUrl = config.get('HELP_URL', { infer: true });
  }

  async send(userId: string, input: unknown): Promise<SendAck> {
    const parsed = messageSendSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        code: 'INVALID_MESSAGE',
        message: 'Pesan tidak valid',
      };
    }
    const { client_message_id: clientMessageId, content } = parsed.data;
    if (content.trim().length === 0) {
      return { ok: false, code: 'EMPTY_MESSAGE', message: 'Pesan kosong' };
    }
    if (Array.from(content).length > MAX_MESSAGE_CHARS) {
      return {
        ok: false,
        code: 'MESSAGE_TOO_LONG',
        message: `Pesan maksimal ${MAX_MESSAGE_CHARS} karakter`,
      };
    }

    const l1 = await this.safety.l1(content);
    const crisis = l1.level === 'crisis';

    if (!crisis && (await this.rateLimited(userId))) {
      return {
        ok: false,
        code: 'RATE_LIMITED',
        message: 'Pelan-pelan dulu ya, tunggu sebentar sebelum mengirim lagi',
      };
    }

    const active = await this.sessions.findActive(userId);
    if (active) {
      const existing = await this.messages.findByClientId(
        active.id,
        clientMessageId,
      );
      if (existing)
        return this.retry(active.id, existing.id, clientMessageId, content);
    }

    if (!active) {
      const refusal = await this.onboarding.gate(userId);
      if (refusal) return this.refuseAtGate(userId, refusal, l1);
    }

    let sessionId = active?.id;
    let precheck: Precheck =
      l1.level === 'crisis'
        ? { crisis: true, layer: 'l1', signals: l1.signals }
        : null;
    let locale = DEFAULT_SESSION_LOCALE;
    if (!sessionId) {
      const opened = await this.open(userId, content, l1);
      if (opened.kind === 'refused') return opened.ack;
      sessionId = opened.sessionId;
      precheck = opened.precheck ?? precheck;
      locale = opened.locale;
    }

    const lock = await this.redis.tryLock(
      turnLockKey(sessionId),
      this.lockTtlMs,
    );
    // A crisis message is never turned away, not even while another turn is running: its
    // path does not call the agent, so it can safely run alongside (lock-free).
    if (!lock && !precheck?.crisis) {
      return {
        ok: false,
        code: 'TURN_IN_PROGRESS',
        message: 'Tunggu balasan sebelumnya selesai',
      };
    }
    let messageId: string;
    let duplicate: boolean;
    try {
      const stored = await this.messages.storeUserMessage(
        sessionId,
        clientMessageId,
        content,
      );
      messageId = stored.message.id;
      duplicate = stored.duplicate;
    } catch (error) {
      if (lock) await this.redis.release(turnLockKey(sessionId), lock);
      throw error;
    }
    this.emitter.emit(userId, 'message.ack', {
      client_message_id: clientMessageId,
      message_id: messageId,
    });
    this.start(sessionId, messageId, l1, precheck, lock, locale);
    return {
      ok: true,
      client_message_id: clientMessageId,
      message_id: messageId,
      duplicate,
      session_id: sessionId,
    };
  }

  /**
   * Age or consent is missing, so the message is neither stored nor sent to the agent. A crisis
   * message still gets the protocol: being outside the gate never blocks the way to help.
   */
  private async refuseAtGate(
    userId: string,
    refusal: GateRefusal,
    l1: L1Result,
  ): Promise<SendAck> {
    const level = l1.level === 'crisis' ? 'crisis' : 'elevated';
    const protocol = await this.safety.protocol(level);
    if (l1.level === 'crisis') {
      await this.safety
        .record({
          sessionId: null,
          layer: 'l1',
          level: 'crisis',
          signals: l1.signals,
        })
        .catch(() => undefined);
      this.emitter.emit(userId, 'safety.escalation', {
        level: 'crisis',
        protocol,
        help_url: this.helpUrl,
      });
      this.metrics.record('crisis_protocol_sent', { path: 'gate' });
    }
    this.metrics.record('gate_refused', { code: refusal.code, risk: l1.level });
    return {
      ok: false,
      code: refusal.code,
      message: refusal.message,
      help: { url: this.helpUrl, contacts: protocol.contacts },
    };
  }

  /** A retry after a reconnect: answer it if the reply never made it, otherwise confirm it. */
  private async retry(
    sessionId: string,
    messageId: string,
    clientMessageId: string,
    content: string,
  ): Promise<SendAck> {
    if (await this.messages.isLatest(sessionId, messageId)) {
      const lock = await this.redis.tryLock(
        turnLockKey(sessionId),
        this.lockTtlMs,
      );
      if (lock) {
        const l1 = await this.safety.l1(content);
        const precheck: Precheck =
          l1.level === 'crisis'
            ? { crisis: true, layer: 'l1', signals: l1.signals }
            : null;
        this.start(sessionId, messageId, l1, precheck, lock);
      }
    }
    return {
      ok: true,
      client_message_id: clientMessageId,
      message_id: messageId,
      duplicate: true,
      session_id: sessionId,
    };
  }

  private async open(
    userId: string,
    content: string,
    l1: L1Result,
  ): Promise<
    | {
        kind: 'opened';
        sessionId: string;
        locale: SessionLocale;
        precheck?: Precheck;
      }
    | { kind: 'refused'; ack: SendAck }
  > {
    const { personaId, locale, nickname } =
      await this.state.pendingSettings(userId);
    const first = await this.sessions.openForMessage(userId, {
      personaId,
      crisis: l1.level === 'crisis',
    });
    // Best effort: without it the agent falls back to the profile's nickname.
    const bind = async (sessionId: string) => {
      if (nickname)
        await this.state
          .bindNickname(sessionId, nickname)
          .catch(() => undefined);
    };
    if (first.kind === 'session') {
      await bind(first.session.id);
      await this.state.broadcast(userId, first.session);
      return { kind: 'opened', sessionId: first.session.id, locale };
    }

    // Quota used up: safety still runs first (02 §6.3 rule 3).
    const { level, signals } = await this.classifyWithoutSession(content, l1);
    if (level === 'crisis') {
      const crisisSession = await this.sessions.openForMessage(userId, {
        personaId,
        crisis: true,
      });
      if (crisisSession.kind === 'session') {
        await bind(crisisSession.session.id);
        await this.state.broadcast(userId, crisisSession.session);
        return {
          kind: 'opened',
          sessionId: crisisSession.session.id,
          locale,
          precheck: { crisis: true, layer: 'l2', signals },
        };
      }
    }
    // Help information always travels with the quota message, so a missed signal still
    // leaves the way to help visible.
    const protocol = await this.safety.protocol('elevated');
    this.emitter.emit(userId, 'quota.exhausted', {
      quota: first.quota,
      resets_at: first.quota.resets_at,
      message: QUOTA_MESSAGE,
      alternatives: ['routine', 'assessment', 'psikolog'],
      help: { contacts: protocol.contacts },
      risk_level: level,
    });
    this.metrics.record('quota_exhausted', { risk: level });
    return {
      kind: 'refused',
      ack: { ok: false, code: 'QUOTA_EXHAUSTED', message: QUOTA_MESSAGE },
    };
  }

  /** L1 + L2 for a message that has no session. L2 unavailable → `elevated` (fail closed). */
  private async classifyWithoutSession(
    content: string,
    l1: L1Result,
  ): Promise<{ level: RiskLevel; signals: string[] }> {
    if (l1.level === 'crisis') return { level: 'crisis', signals: l1.signals };
    try {
      const l2 = await this.agent.classify({
        message: content,
        history: toAgentHistory([]),
      });
      return {
        level: maxRisk(l1.level, l2.level),
        signals: [...l1.signals, ...l2.signals],
      };
    } catch {
      this.metrics.record('l2_unavailable', { path: 'quota' });
      return {
        level: maxRisk(l1.level, 'elevated'),
        signals: [...l1.signals, 'l2:unavailable'],
      };
    }
  }

  private start(
    sessionId: string,
    messageId: string,
    l1: L1Result,
    precheck: Precheck,
    lock: string | null,
    locale: SessionLocale = DEFAULT_SESSION_LOCALE,
  ): void {
    // Idempotent: called as soon as the reply is stored, and again in `finally`.
    let released = !lock;
    const releaseTurn = async (): Promise<void> => {
      if (released || !lock) return;
      released = true;
      await this.redis
        .release(turnLockKey(sessionId), lock)
        .catch(() => undefined);
    };
    // One span per turn; the agent call inside inherits it (W3C traceparent). No content.
    const work = tracer
      .startActiveSpan('ai.turn', async (span) => {
        span.setAttribute('ai.path', precheck?.crisis ? 'crisis' : 'agent');
        try {
          await this.runTurn(
            sessionId,
            messageId,
            l1,
            precheck,
            releaseTurn,
            locale,
          );
        } catch (error) {
          span.setStatus({ code: SpanStatusCode.ERROR });
          throw error;
        } finally {
          span.end();
        }
      })
      .catch((error: unknown) =>
        this.logger.error({
          err: { name: error instanceof Error ? error.name : typeof error },
        }),
      )
      .finally(() => releaseTurn());
    void this.drainService.track(work);
  }

  private async runTurn(
    sessionId: string,
    messageId: string,
    l1: L1Result,
    precheck: Precheck,
    releaseTurn: () => Promise<void>,
    locale: SessionLocale,
  ): Promise<void> {
    const session = await this.sessions.findById(sessionId);
    if (!session) return;
    if (precheck?.crisis) {
      await this.conversation.crisisTurn(
        session,
        messageId,
        precheck.signals,
        precheck.layer,
        releaseTurn,
      );
    } else {
      await this.conversation.run(
        sessionId,
        messageId,
        l1,
        releaseTurn,
        locale,
      );
    }
  }

  private async rateLimited(userId: string): Promise<boolean> {
    try {
      return (await this.redis.hit(`rate:${userId}`, 60)) > this.ratePerMinute;
    } catch {
      // Redis trouble must not block conversations; the turn lock still bounds concurrency.
      return false;
    }
  }
}
