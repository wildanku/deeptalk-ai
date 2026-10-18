import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { uuidv7 } from 'uuidv7';
import { UserEmitter } from '../common/emitter/user-emitter.service';
import { ConsentsService } from '../consents/consents.service';
import type { Environment } from '../config/env.schema';
import { PrismaService } from '../database/prisma.service';
import type { ai_sessions } from '../generated/prisma/client';
import type { TokenUsage } from '../agent-client/agent-events';
import { MetricsService } from '../observability/metrics.service';
import { OutboxService } from '../outbox/outbox.service';
import { nextSessionRisk, type RiskLevel } from '../safety/risk';
import { periodMonth } from './period';
import { activeIncrement, quotaResetsAt } from './quota';

export interface QuotaView {
  used: number;
  limit: number;
  resets_at: string;
}

export type SessionOpenResult =
  | { kind: 'session'; session: ai_sessions; created: boolean }
  | { kind: 'quota_exhausted'; quota: QuotaView };

export interface ActivityResult {
  session: ai_sessions;
  /** The warning threshold was crossed by this activity. */
  warningNow: boolean;
  /** The active-time limit was crossed by this activity; the grace period starts. */
  closingNow: boolean;
}

export type EndReason = 'completed' | 'idle' | 'wall_clock' | 'user_ended';

/**
 * Session lifecycle, monthly quota, and active time (02 §6.3). Quota decisions and session
 * creation run in one transaction holding the `ai_user_state` row lock, so two devices cannot
 * both pass the quota. Sessions that ever reached `crisis` never count toward the quota and
 * are exempt from the active-time and wall-clock limits.
 */
@Injectable()
export class SessionsService {
  private readonly timeZone: string;
  private readonly limits: {
    quota: number;
    active: number;
    warningAt: number;
    grace: number;
    gapCap: number;
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly emitter: UserEmitter,
    private readonly consents: ConsentsService,
    private readonly metrics: MetricsService,
    config: ConfigService<Environment, true>,
  ) {
    this.timeZone = config.get('DEFAULT_TIMEZONE', { infer: true });
    this.limits = {
      quota: config.get('SESSION_QUOTA_PER_MONTH', { infer: true }),
      active: config.get('SESSION_ACTIVE_LIMIT_SECONDS', { infer: true }),
      warningAt: config.get('SESSION_WARNING_AT_SECONDS', { infer: true }),
      grace: config.get('SESSION_GRACE_SECONDS', { infer: true }),
      gapCap: config.get('ACTIVE_GAP_CAP_SECONDS', { infer: true }),
    };
  }

  get activeLimitSeconds(): number {
    return this.limits.active;
  }

  findActive(userId: string): Promise<ai_sessions | null> {
    return this.prisma.ai_sessions.findFirst({
      where: { user_id: userId, status: { in: ['active', 'closing'] } },
      orderBy: { started_at: 'desc' },
    });
  }

  findById(sessionId: string): Promise<ai_sessions | null> {
    return this.prisma.ai_sessions.findUnique({ where: { id: sessionId } });
  }

  async quota(userId: string, now = new Date()): Promise<QuotaView> {
    const period = periodMonth(now, this.timeZone);
    const used = await this.prisma.ai_sessions.count({
      where: {
        user_id: userId,
        period_month: period,
        counts_toward_quota: true,
      },
    });
    return this.quotaView(used, period);
  }

  /**
   * The user's open session, or a new one. A new session is refused when the monthly quota is
   * used up — unless `crisis`: a crisis session always opens and never counts (02 §6.3).
   */
  openForMessage(
    userId: string,
    options: { personaId: string | null; crisis: boolean },
  ): Promise<SessionOpenResult> {
    // Read before the transaction: a query on the shared pool inside an interactive transaction
    // can starve the pool under load (every connection held by a transaction waiting for
    // another one). Found by the Phase 6 load test.
    const trainingConsent = options.crisis
      ? Promise.resolve(false)
      : // Never left unobserved, and an error only ever excludes the session from training.
        this.consents.trainingActive(userId).catch(() => false);
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        INSERT INTO ai_user_state (user_id, updated_at)
        VALUES (${userId}, now())
        ON CONFLICT (user_id) DO NOTHING`;
      await tx.$queryRaw`
        SELECT user_id FROM ai_user_state WHERE user_id = ${userId} FOR UPDATE`;
      const existing = await tx.ai_sessions.findFirst({
        where: { user_id: userId, status: { in: ['active', 'closing'] } },
        orderBy: { started_at: 'desc' },
      });
      if (existing)
        return { kind: 'session', session: existing, created: false };

      const now = new Date();
      const period = periodMonth(now, this.timeZone);
      const used = await tx.ai_sessions.count({
        where: {
          user_id: userId,
          period_month: period,
          counts_toward_quota: true,
        },
      });
      if (!options.crisis && used >= this.limits.quota) {
        return { kind: 'quota_exhausted', quota: this.quotaView(used, period) };
      }
      // Only sessions held while training consent is active may ever be exported (02 §9.2).
      const training = await trainingConsent;
      const session = await tx.ai_sessions.create({
        data: {
          id: uuidv7(),
          user_id: userId,
          persona_id: options.personaId,
          period_month: period,
          started_at: now,
          last_activity_at: now,
          counts_toward_quota: !options.crisis,
          exclude_from_training: !training,
          max_risk_level: options.crisis ? 'crisis' : 'normal',
        },
      });
      await tx.ai_user_state.update({
        where: { user_id: userId },
        data: { last_session_at: now },
      });
      return { kind: 'session', session, created: true };
    });
  }

  async setPersona(
    sessionId: string,
    persona: { id: string; version: number; topics: string[] },
    routerReason?: string | null,
  ): Promise<ai_sessions> {
    return this.prisma.ai_sessions.update({
      where: { id: sessionId },
      data: {
        persona_id: persona.id,
        persona_version: persona.version,
        topics: persona.topics,
        ...(routerReason !== undefined ? { router_reason: routerReason } : {}),
      },
    });
  }

  /** Counts one persona turn and its tokens (cost per session, 02 §12.3). */
  async addUsage(sessionId: string, usage: TokenUsage): Promise<void> {
    await this.prisma.ai_sessions.update({
      where: { id: sessionId },
      data: {
        turns: { increment: 1 },
        tokens_input: { increment: usage.input_tokens },
        tokens_output: { increment: usage.output_tokens },
      },
    });
  }

  /** Adds active time for one activity (user message or finished reply). */
  async recordActivity(
    sessionId: string,
    now = new Date(),
  ): Promise<ActivityResult> {
    return this.prisma.$transaction(async (tx) => {
      const [locked] = await tx.$queryRaw<ai_sessions[]>`
        SELECT * FROM ai_sessions WHERE id = ${sessionId}::uuid FOR UPDATE`;
      if (!locked) throw new Error('Session not found');
      const crisis = locked.max_risk_level === 'crisis';
      const active =
        locked.active_seconds +
        activeIncrement(locked.last_activity_at, now, this.limits.gapCap);
      const warningNow =
        !crisis && !locked.warning_sent && active >= this.limits.warningAt;
      const closingNow =
        !crisis && locked.status === 'active' && active >= this.limits.active;
      const session = await tx.ai_sessions.update({
        where: { id: sessionId },
        data: {
          active_seconds: active,
          last_activity_at: now,
          ...(warningNow ? { warning_sent: true } : {}),
          ...(closingNow
            ? {
                status: 'closing',
                closing_deadline: new Date(
                  now.getTime() + this.limits.grace * 1000,
                ),
              }
            : {}),
        },
      });
      return { session, warningNow, closingNow };
    });
  }

  /**
   * Applies one turn's risk level to the session (sticky, 02 §7.2). Reaching `crisis` removes
   * the session from the quota, excludes it from training, and lifts any pending close.
   */
  async applyRisk(
    sessionId: string,
    turn: RiskLevel,
  ): Promise<{ session: ai_sessions; becameCrisis: boolean }> {
    return this.prisma.$transaction(async (tx) => {
      const [locked] = await tx.$queryRaw<ai_sessions[]>`
        SELECT * FROM ai_sessions WHERE id = ${sessionId}::uuid FOR UPDATE`;
      if (!locked) throw new Error('Session not found');
      const next = nextSessionRisk(
        { level: locked.max_risk_level, normalStreak: locked.normal_streak },
        turn,
      );
      const becameCrisis =
        next.level === 'crisis' && locked.max_risk_level !== 'crisis';
      const session = await tx.ai_sessions.update({
        where: { id: sessionId },
        data: {
          max_risk_level: next.level,
          normal_streak: next.normalStreak,
          ...(becameCrisis
            ? {
                counts_toward_quota: false,
                exclude_from_training: true,
                status: 'active',
                closing_deadline: null,
              }
            : {}),
        },
      });
      return { session, becameCrisis };
    });
  }

  /**
   * Ends an open session; idempotent. Queues the cross-session summary (02 §6.5) unless the
   * session's history is about to be deleted (`summarize: false`).
   */
  async close(
    sessionId: string,
    reason: EndReason,
    options: { summarize?: boolean } = {},
  ): Promise<boolean> {
    const result = await this.prisma.$transaction(async (tx) => {
      const ended = await tx.ai_sessions.updateMany({
        where: { id: sessionId, status: { in: ['active', 'closing'] } },
        data: { status: 'ended', end_reason: reason, ended_at: new Date() },
      });
      if (ended.count === 0) return null;
      const session = await tx.ai_sessions.findUniqueOrThrow({
        where: { id: sessionId },
      });
      const outboxId =
        options.summarize === false
          ? null
          : await this.outbox.add(
              'session_summary',
              { session_id: sessionId },
              tx,
            );
      return { session, outboxId };
    });
    if (!result) return false;
    if (result.outboxId) await this.outbox.dispatch(result.outboxId);
    this.metrics.record('session_ended', {
      reason,
      risk: result.session.max_risk_level,
      persona: result.session.persona_id ?? 'none',
      turns: result.session.turns,
      tokens_input: result.session.tokens_input,
      tokens_output: result.session.tokens_output,
      active_seconds: result.session.active_seconds,
    });
    const offer = await this.consents
      .trainingOffer(result.session)
      .catch(() => null);
    this.emitter.emit(result.session.user_id, 'session.ended', {
      session_id: sessionId,
      reason,
      quota: await this.quota(result.session.user_id),
      consent_offer: offer,
    });
    return true;
  }

  private quotaView(used: number, period: string): QuotaView {
    return {
      used: Math.min(used, this.limits.quota),
      limit: this.limits.quota,
      resets_at: quotaResetsAt(period, this.timeZone).toISOString(),
    };
  }
}
