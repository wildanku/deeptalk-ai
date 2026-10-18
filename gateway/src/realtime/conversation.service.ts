import { describeError } from '../common/describe-error';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { uuidv7 } from 'uuidv7';
import { AgentClient } from '../agent-client/agent-client.service';
import type { AgentEvent, TurnContext } from '../agent-client/agent-events';
import { AssessmentsService } from '../assessments/assessments.service';
import { ReferralsService } from '../assessments/referrals.service';
import { UserEmitter } from '../common/emitter/user-emitter.service';
import type { Environment } from '../config/env.schema';
import { ContentService, type ActivePersona } from '../content/content.service';
import type { ai_sessions } from '../generated/prisma/client';
import { HandoffsService } from '../handoffs/handoffs.service';
import { MessagesService } from '../messages/messages.service';
import { MetricsService } from '../observability/metrics.service';
import { RecommendationsService } from '../recommendations/recommendations.service';
import { RedisService } from '../redis/redis.service';
import { RoutinesService } from '../routines/routines.service';
import type { L1Result } from '../safety/l1';
import { maxRisk, type RiskLevel } from '../safety/risk';
import { SafetyService } from '../safety/safety.service';
import { toAgentHistory } from '../sessions/history';
import { MemoryService } from '../sessions/memory.service';
import {
  type PendingReply,
  SessionTimersService,
  turnInflightKey,
} from '../sessions/session-timers.service';
import { SessionsService } from '../sessions/sessions.service';
import type { V3UserAssessment } from '../v3-client/v3-client.service';
import { V3Client } from '../v3-client/v3-client.service';
import { personaView } from '../content/persona-view';
import { PersonaUsageService, routerCandidates } from './persona-pool';
import {
  DEFAULT_SESSION_LOCALE,
  SessionStateService,
  type SessionLocale,
} from './session-state.service';

const AI_UNAVAILABLE_MESSAGE =
  'DeepTalk AI sedang tidak bisa membalas. Pesanmu sudah tersimpan, coba kirim ulang sebentar lagi.';
const CONTEXT_TTL_SECONDS = 3_600;
const CARDS_TTL_SECONDS = 86_400;
/** Default when the caller holds no turn lock. */
const NO_LOCK = (): Promise<void> => Promise.resolve();

interface SessionContextCache {
  profile: {
    nickname: string | null;
    age_band: string | null;
    // Absent in entries cached before 2026-10-18.
    gender?: string | null;
  };
  assessments: V3UserAssessment[];
}

class TurnFailed extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'TurnFailed';
  }
}

/** Age band only — the agent never sees a birth date (02 §6.5). */
export function ageBand(
  birthDate: string | null,
  now = new Date(),
): string | null {
  if (!birthDate) return null;
  const born = new Date(`${birthDate}T00:00:00Z`);
  if (Number.isNaN(born.getTime())) return null;
  let age = now.getUTCFullYear() - born.getUTCFullYear();
  const beforeBirthday =
    now.getUTCMonth() < born.getUTCMonth() ||
    (now.getUTCMonth() === born.getUTCMonth() &&
      now.getUTCDate() < born.getUTCDate());
  if (beforeBirthday) age -= 1;
  if (age < 18) return 'under_18';
  if (age < 25) return '18-24';
  if (age < 35) return '25-34';
  if (age < 45) return '35-44';
  return '45+';
}

/**
 * One conversation turn after the user message is stored (02 §6.4).
 *
 * Safety ordering, which must not be weakened:
 *  1. L1 already ran in `TurnService`; a crisis there never reaches the agent.
 *  2. Persona tokens are held here until the agent's `safety` verdict arrives (a second gate
 *     behind the agent's own), and dropped entirely when the turn is `crisis`.
 *  3. If the agent is unavailable, the user gets an error with help information (fail closed).
 */
@Injectable()
export class ConversationService {
  private readonly logger = new Logger(ConversationService.name);
  private readonly historyLimit: number;
  private readonly warningAt: number;
  private readonly helpUrl: string;
  private readonly inflightTtlSeconds: number;

  constructor(
    private readonly sessions: SessionsService,
    private readonly timers: SessionTimersService,
    private readonly state: SessionStateService,
    private readonly messages: MessagesService,
    private readonly agent: AgentClient,
    private readonly content: ContentService,
    private readonly safety: SafetyService,
    private readonly memory: MemoryService,
    private readonly routines: RoutinesService,
    private readonly assessments: AssessmentsService,
    private readonly referrals: ReferralsService,
    private readonly handoffs: HandoffsService,
    private readonly recommendations: RecommendationsService,
    private readonly v3: V3Client,
    private readonly redis: RedisService,
    private readonly emitter: UserEmitter,
    private readonly metrics: MetricsService,
    private readonly personaUsage: PersonaUsageService,
    config: ConfigService<Environment, true>,
  ) {
    this.historyLimit = config.get('TURN_HISTORY_MESSAGES', { infer: true });
    this.warningAt = config.get('SESSION_WARNING_AT_SECONDS', { infer: true });
    this.helpUrl = config.get('HELP_URL', { infer: true });
    // Same lifetime as the turn lock: a crashed instance's marker expires with it.
    this.inflightTtlSeconds = Math.ceil(
      (config.get('AGENT_TURN_TIMEOUT_MS', { infer: true }) + 15_000) / 1000,
    );
  }

  /**
   * A crisis caught before the agent ran (L1, or L2 on the quota-exhausted path): the protocol
   * replaces any persona reply and the persona is not called.
   */
  async crisisTurn(
    session: ai_sessions,
    userMessageId: string,
    signals: string[],
    layer: 'l1' | 'l2',
    releaseTurn: () => Promise<void> = NO_LOCK,
  ): Promise<void> {
    await this.safety.record({
      sessionId: session.id,
      messageId: userMessageId,
      layer,
      level: 'crisis',
      signals,
    });
    const { session: updated } = await this.sessions.applyRisk(
      session.id,
      'crisis',
    );
    await this.sendProtocol(updated, 'crisis', releaseTurn);
    const activity = await this.sessions.recordActivity(session.id);
    await this.timers.touch(activity.session);
    await this.state.broadcast(session.user_id, activity.session);
    this.metrics.record('ai_turn', { outcome: 'protocol', layer });
  }

  /**
   * `releaseTurn` frees the per-session turn lock. It is called once the reply (or protocol) is
   * stored and *before* it is emitted, so a user who has seen the reply can always send the
   * next message — card processing afterwards must never make them wait.
   */
  async run(
    sessionId: string,
    userMessageId: string,
    l1: L1Result,
    releaseTurn: () => Promise<void> = NO_LOCK,
    locale: SessionLocale = DEFAULT_SESSION_LOCALE,
  ): Promise<void> {
    const started = Date.now();
    let session = await this.sessions.findById(sessionId);
    if (!session) return;
    const userId = session.user_id;
    const assistantId = uuidv7();
    let marked = false;

    try {
      const recent = await this.messages.recent(
        sessionId,
        this.historyLimit + 1,
      );
      const current = recent.at(-1);
      // Answered meanwhile (e.g. by another instance) — nothing to do.
      if (!current || current.id !== userMessageId || current.role !== 'user')
        return;

      marked = await this.markInflight(sessionId, {
        user_message_id: userMessageId,
        message_id: assistantId,
        started_at: new Date(started).toISOString(),
      });

      const routerStarted = Date.now();
      const persona = await this.resolvePersona(
        session,
        current.content,
        locale,
      );
      const routerMs = Date.now() - routerStarted;
      session = (await this.sessions.findById(sessionId)) ?? session;

      const userActivity = await this.sessions.recordActivity(sessionId);
      session = userActivity.session;
      this.announceActivity(userActivity);

      const contextStarted = Date.now();
      const context = await this.context(session, persona, l1);
      const contextMs = Date.now() - contextStarted;
      const outcome = await this.stream(
        session,
        persona,
        current.content,
        recent.slice(0, -1),
        context,
        l1,
        { started, routerMs, contextMs, assistantId },
        releaseTurn,
      );
      if (!outcome) return;

      const replyActivity = await this.sessions.recordActivity(sessionId);
      this.announceActivity(replyActivity);
      await this.timers.touch(replyActivity.session);
      await this.offerCards(
        replyActivity.session,
        outcome.cards,
        recent,
        outcome.messageId,
      );
    } catch (error) {
      const code =
        error instanceof TurnFailed ? error.code : 'AGENT_UNAVAILABLE';
      if (marked) await this.clearInflight(sessionId);
      // Fail closed (02 §7.2): L1 already ran; the user is told and shown where help is.
      const protocol = await this.safety.protocol('crisis');
      this.emitter.emit(userId, 'ai.error', {
        code: 'AI_UNAVAILABLE',
        message: AI_UNAVAILABLE_MESSAGE,
        message_id: userMessageId,
        help: { url: this.helpUrl, contacts: protocol.contacts },
      });
      this.metrics.record('ai_turn', {
        outcome: 'error',
        error: code,
        duration_ms: Date.now() - started,
      });
      // `status` tells why the agent failed: 401/403 = invoker permission, 404 = wrong
      // AGENT_URL, 5xx = agent error; none = unreachable or ID token. `code` on the error itself
      // is more specific than AGENT_UNAVAILABLE: TIMEOUT_TOTAL/TIMEOUT_IDLE, NOT_EVENT_STREAM.
      this.logger.error({ err: { code, ...describeError(error) } });
      const latest = await this.sessions.findById(sessionId);
      if (latest) await this.timers.touch(latest);
    } finally {
      if (marked) await this.clearInflight(sessionId);
    }
  }

  /** The reply in progress for a session (`GET /sessions/current`), or null. */
  async pendingReply(sessionId: string): Promise<PendingReply | null> {
    return this.redis
      .getJson<PendingReply>(turnInflightKey(sessionId))
      .catch(() => null);
  }

  /** Best effort: without Redis a reloaded client only misses the "replying" hint. */
  private async markInflight(
    sessionId: string,
    reply: PendingReply,
  ): Promise<boolean> {
    try {
      await this.redis.setJson(
        turnInflightKey(sessionId),
        reply,
        this.inflightTtlSeconds,
      );
      return true;
    } catch {
      return false;
    }
  }

  private async clearInflight(sessionId: string): Promise<void> {
    await this.redis.del(turnInflightKey(sessionId)).catch(() => undefined);
  }

  private async resolvePersona(
    session: ai_sessions,
    firstMessage: string,
    locale: SessionLocale,
  ): Promise<ActivePersona | null> {
    const active = await this.content.activePersonas();
    if (session.persona_id) {
      const persona = await this.content.persona(session.persona_id);
      if (persona) return persona;
      // Disabled mid-session by its psikolog: takes effect immediately (02 §6.2).
      const fallback =
        active.find((candidate) => candidate.id !== session.persona_id) ?? null;
      if (fallback) {
        await this.sessions.setPersona(session.id, {
          id: fallback.id,
          version: fallback.version,
          topics: fallback.card.focus_topics,
        });
      }
      this.emitter.emit(session.user_id, 'persona.unavailable', {
        persona_id: session.persona_id,
        fallback_persona: fallback ? personaView(fallback) : null,
      });
      return fallback;
    }
    if (active.length === 0) return null;
    // Quick Chat: the router picks a persona from the first message and says why (Konsep §3.1).
    // Candidates are capped and least-used first, so load spreads across psikolog (Phase 8).
    const candidates = routerCandidates(
      active,
      await this.personaUsage.usage().catch(() => new Map<string, number>()),
    );
    let chosen = candidates[0];
    let reason =
      locale === 'en'
        ? `I'm connecting you with the ${chosen.displayName} approach.`
        : `Aku hubungkan kamu dengan pendekatan ${chosen.displayName}.`;
    let topics = chosen.card.focus_topics;
    try {
      const routed = await this.agent.routerSelect({
        message: firstMessage,
        locale,
        personas: candidates.map((persona) => ({
          id: persona.id,
          display_name: persona.displayName,
          approach: persona.card.approach,
          focus_topics: persona.card.focus_topics,
        })),
      });
      const match = candidates.find(
        (persona) => persona.id === routed.persona_id,
      );
      if (match) {
        chosen = match;
        reason = routed.reason.slice(0, 500);
        topics = routed.topics.length
          ? routed.topics.slice(0, 5)
          : match.card.focus_topics;
      }
    } catch {
      this.metrics.record('router', { outcome: 'fallback' });
    }
    const updated = await this.sessions.setPersona(
      session.id,
      {
        id: chosen.id,
        version: chosen.version,
        topics,
      },
      reason,
    );
    await this.state.clearPending(session.user_id);
    await this.state.broadcast(session.user_id, updated);
    return chosen;
  }

  private announceActivity(activity: {
    session: ai_sessions;
    warningNow: boolean;
    closingNow: boolean;
  }) {
    const { session } = activity;
    if (activity.warningNow) {
      this.emitter.emit(session.user_id, 'session.warning', {
        remaining_seconds: Math.max(
          0,
          this.sessions.activeLimitSeconds - session.active_seconds,
        ),
      });
    }
    if (activity.closingNow) {
      this.emitter.emit(session.user_id, 'session.closing', {
        closes_at: session.closing_deadline?.toISOString() ?? null,
      });
    }
  }

  private async context(
    session: ai_sessions,
    persona: ActivePersona | null,
    l1: L1Result,
  ): Promise<TurnContext> {
    const [cached, sessionNickname] = await Promise.all([
      this.sessionContext(session),
      this.state.sessionNickname(session.id),
    ]);
    const effective = maxRisk(session.max_risk_level, l1.level);
    const offered = await this.offeredCards(session.id);
    const topics = session.topics.length
      ? session.topics
      : (persona?.card.focus_topics ?? []);

    const [
      summaries,
      routineAdherence,
      activeRoutines,
      knowledge,
      routineItems,
      assessments,
      psikologs,
      directory,
    ] = await Promise.all([
      this.memory.recentSummaries(session.user_id),
      this.routines.adherence(session.user_id),
      this.routines.activeCount(session.user_id),
      this.content.listActive('knowledge'),
      this.routines.catalogFor(topics),
      this.assessments.catalogFor(topics),
      this.handoffs.directory().catch(() => []),
      this.recommendations.candidates(topics).catch(() => []),
    ]);

    const allowRoutine =
      effective === 'normal' &&
      activeRoutines < 2 &&
      !offered.includes('routine') &&
      routineItems.length > 0;
    const allowAssessment =
      effective !== 'crisis' &&
      !offered.includes('assessment') &&
      assessments.length > 0;
    const allowHandoff = !offered.includes('handoff') && psikologs.length > 0;
    // Pointing to a public profile is fine at `elevated` too; crisis turns never reach the agent.
    const allowRecommendation =
      effective !== 'crisis' &&
      !offered.includes('recommendation') &&
      directory.length > 0;

    return {
      persona: persona
        ? {
            id: persona.id,
            display_name: persona.displayName,
            version: persona.version,
            card: persona.card,
          }
        : null,
      knowledge: knowledge
        .filter((item) => topics.includes(item.body.topic))
        .slice(0, 3)
        .map((item) => ({
          topic: item.body.topic,
          title: item.body.title,
          content: item.body.content,
        })),
      memory: {
        summaries,
        profile: {
          // The name chosen for this session wins over the account's nickname.
          nickname: sessionNickname ?? cached.profile.nickname,
          age_band: cached.profile.age_band,
          gender: cached.profile.gender ?? null,
        },
        routines: routineAdherence,
        assessments: cached.assessments,
      },
      state: {
        risk_level: effective,
        wrap_up:
          session.active_seconds >= this.warningAt ||
          session.status === 'closing',
        allow_routine: allowRoutine,
        allow_assessment: allowAssessment,
        allow_handoff: allowHandoff,
        allow_recommendation: allowRecommendation,
        offered_cards: offered,
      },
      catalog: {
        routine_items: allowRoutine ? routineItems : [],
        assessments: allowAssessment ? assessments : [],
        psikologs: allowHandoff
          ? psikologs.map((p) => ({
              id: p.id,
              name: p.name,
              specialists: p.specialists,
            }))
          : [],
        directory: allowRecommendation
          ? directory.map((c) => ({
              id: c.id,
              name: c.name,
              specialists: c.specialists,
              year_experience: c.year_experience,
              rating: c.rating?.rate ?? null,
              reviews: c.rating?.total ?? 0,
              persona: c.persona,
            }))
          : [],
      },
    };
  }

  /**
   * Streams the agent's turn. The reply is stored and `ai.done` emitted as soon as the agent's
   * `done` arrives; card events may follow it on the same stream, and a failure after that point
   * only drops the cards — the user already has their reply.
   */
  private async stream(
    session: ai_sessions,
    persona: ActivePersona | null,
    message: string,
    previous: Awaited<ReturnType<MessagesService['recent']>>,
    context: TurnContext,
    l1: L1Result,
    timing: {
      started: number;
      routerMs: number;
      contextMs: number;
      assistantId: string;
    },
    releaseTurn: () => Promise<void>,
  ): Promise<{
    cards: Extract<AgentEvent, { event: 'structured' }>[];
    messageId: string;
  } | null> {
    const userId = session.user_id;
    const { started, assistantId } = timing;
    const abort = new AbortController();
    const held: string[] = [];
    const cards: Extract<AgentEvent, { event: 'structured' }>[] = [];
    let verdict: RiskLevel | null = null;
    let firstTokenMs: number | undefined;
    let firstEventMs: number | undefined;
    let delivered = false;

    try {
      for await (const event of this.agent.streamTurn(
        {
          session_id: session.id,
          message,
          history: toAgentHistory(previous),
          ...context,
        },
        abort.signal,
      )) {
        firstEventMs ??= Date.now() - started;
        if (event.event === 'safety') {
          this.metrics.record('l2_verdict', {
            level: event.level,
            timed_out: event.timed_out,
          });
          const turnLevel = maxRisk(l1.level, event.level);
          const before = session.max_risk_level;
          const { session: updated } = await this.sessions.applyRisk(
            session.id,
            turnLevel,
          );
          if (turnLevel !== 'normal') {
            await this.safety.record({
              sessionId: session.id,
              layer: event.level === turnLevel ? 'l2' : 'l1',
              level: turnLevel,
              signals: [
                ...l1.signals,
                ...event.signals,
                ...(event.timed_out ? ['l2:timeout'] : []),
              ],
            });
          }
          if (turnLevel === 'crisis') {
            // Safety gate: nothing the persona produced for this turn is ever shown.
            abort.abort();
            await this.sendProtocol(updated, 'crisis', releaseTurn);
            await this.state.broadcast(userId, updated);
            this.metrics.record('ai_turn', {
              outcome: 'protocol',
              layer: 'l2',
              duration_ms: Date.now() - started,
            });
            return null;
          }
          if (turnLevel === 'elevated' && before === 'normal') {
            const protocol = await this.safety.protocol('elevated');
            this.emitter.emit(userId, 'safety.escalation', {
              level: 'elevated',
              protocol,
            });
            await this.state.broadcast(userId, updated);
          }
          verdict = turnLevel;
          if (held.length > 0) firstTokenMs ??= Date.now() - started;
          for (const delta of held.splice(0))
            this.emitter.emit(userId, 'ai.token', {
              message_id: assistantId,
              delta,
            });
        } else if (event.event === 'token') {
          if (verdict === null) held.push(event.delta);
          else {
            // SLO "time to first token" is what the user sees, after the safety gate.
            firstTokenMs ??= Date.now() - started;
            this.emitter.emit(userId, 'ai.token', {
              message_id: assistantId,
              delta: event.delta,
            });
          }
        } else if (event.event === 'structured') {
          cards.push(event);
        } else if (event.event === 'done') {
          // A reply without a verdict never reaches the user (the gate failed open upstream).
          if (verdict === null) throw new TurnFailed('MISSING_SAFETY_VERDICT');
          if (event.aborted) throw new TurnFailed('INCOMPLETE_STREAM');
          await this.deliver(session, persona, event, verdict, releaseTurn, {
            ...timing,
            firstTokenMs,
            firstEventMs,
          });
          delivered = true;
        } else if (event.event === 'error') {
          if (delivered) {
            this.metrics.record('cards_dropped', { reason: event.code });
            break;
          }
          throw new TurnFailed(event.code);
        }
      }
    } catch (error) {
      if (!delivered) throw error;
      // The reply is stored and shown; only the cards that would have followed are lost.
      this.metrics.record('cards_dropped', {
        reason: describeError(error).code ?? 'STREAM_ERROR',
      });
    }
    if (!delivered) {
      if (verdict === null) throw new TurnFailed('MISSING_SAFETY_VERDICT');
      throw new TurnFailed('INCOMPLETE_STREAM');
    }
    return { cards, messageId: assistantId };
  }

  /** Stores the finished reply, frees the turn, and shows it — before any card work. */
  private async deliver(
    session: ai_sessions,
    persona: ActivePersona | null,
    done: Extract<AgentEvent, { event: 'done' }>,
    verdict: RiskLevel,
    releaseTurn: () => Promise<void>,
    timing: {
      started: number;
      routerMs: number;
      contextMs: number;
      assistantId: string;
      firstTokenMs?: number;
      firstEventMs?: number;
    },
  ): Promise<void> {
    if (done.replaced) {
      await this.safety.record({
        sessionId: session.id,
        layer: 'l3',
        level: verdict,
        signals: ['l3:replaced'],
      });
    }
    const stored = await this.messages.storeAssistantMessage(
      session.id,
      timing.assistantId,
      done.content,
      {
        model: done.model,
        prompt_version: done.prompt_version,
        persona_version: persona?.version ?? null,
        risk_level: verdict,
      },
    );
    await this.clearInflight(session.id);
    await releaseTurn();
    this.emitter.emit(session.user_id, 'ai.done', {
      message_id: timing.assistantId,
      content: done.content,
      replaced: done.replaced,
      created_at: stored.created_at.toISOString(),
    });
    await this.sessions.addUsage(session.id, done.usage);
    this.metrics.record('ai_turn', {
      outcome: 'ok',
      duration_ms: Date.now() - timing.started,
      first_token_ms: timing.firstTokenMs ?? -1,
      agent_first_event_ms: timing.firstEventMs ?? -1,
      router_ms: timing.routerMs,
      context_ms: timing.contextMs,
      input_tokens: done.usage.input_tokens,
      output_tokens: done.usage.output_tokens,
      cached_tokens: done.usage.cached_tokens,
      model: done.model,
      risk: verdict,
      replaced: done.replaced,
    });
  }

  /** Validates every proposed card; anything invalid is dropped silently and counted (02 §7.4). */
  private async offerCards(
    session: ai_sessions,
    cards: Extract<AgentEvent, { event: 'structured' }>[],
    recent: Awaited<ReturnType<MessagesService['recent']>>,
    /** The reply these cards belong to; the client shows them under it. */
    messageId: string,
  ): Promise<void> {
    const risk = session.max_risk_level;
    const offered = await this.offeredCards(session.id);
    for (const card of cards) {
      if (offered.includes(card.type)) {
        this.metrics.record('card_rejected', {
          type: card.type,
          reason: 'already_offered',
        });
        continue;
      }
      try {
        if (card.type === 'routine') {
          const result = await this.routines.propose(
            session.user_id,
            session.id,
            risk,
            card.data,
            messageId,
          );
          if (!result.ok) {
            this.metrics.record('card_rejected', {
              type: 'routine',
              reason: result.reason,
            });
            continue;
          }
          this.emitter.emit(session.user_id, 'card.routine', {
            proposal_id: result.proposalId,
            routine: result.routine,
            status: 'proposed',
            message_id: messageId,
          });
        } else if (card.type === 'assessment') {
          const valid =
            risk !== 'crisis'
              ? await this.assessments.validate(card.data)
              : null;
          if (!valid) {
            this.metrics.record('card_rejected', {
              type: 'assessment',
              reason: 'invalid',
            });
            continue;
          }
          const referralId = await this.referrals.offered(
            session.user_id,
            session.id,
            valid,
          );
          this.emitter.emit(session.user_id, 'card.assessment', {
            ...valid,
            referral_id: referralId,
            message_id: messageId,
          });
        } else if (card.type === 'recommendation') {
          const recommendation =
            risk !== 'crisis'
              ? await this.recommendations.offer({
                  userId: session.user_id,
                  sessionId: session.id,
                  input: card.data,
                  messageId,
                })
              : null;
          if (!recommendation) {
            this.metrics.record('card_rejected', {
              type: 'recommendation',
              reason: 'invalid',
            });
            continue;
          }
          this.emitter.emit(session.user_id, 'card.recommendation', {
            ...recommendation,
          });
        } else {
          const cached = await this.sessionContext(session);
          const handoff = await this.handoffs.propose({
            userId: session.user_id,
            sessionId: session.id,
            input: card.data,
            history: toAgentHistory(recent),
            routines: await this.routines.adherence(session.user_id),
            assessments: cached.assessments,
            risk,
          });
          if (!handoff) {
            this.metrics.record('card_rejected', {
              type: 'handoff',
              reason: 'invalid',
            });
            continue;
          }
          this.emitter.emit(session.user_id, 'card.handoff', { ...handoff });
        }
        await this.markOffered(session.id, card.type);
        offered.push(card.type);
        this.metrics.record('card_offered', { type: card.type });
      } catch (error) {
        this.metrics.record('card_rejected', {
          type: card.type,
          reason: 'error',
        });
        this.logger.warn({
          err: { name: error instanceof Error ? error.name : typeof error },
        });
      }
    }
  }

  private async sendProtocol(
    session: ai_sessions,
    level: 'crisis' | 'elevated',
    releaseTurn: () => Promise<void> = NO_LOCK,
  ): Promise<void> {
    const protocol = await this.safety.protocol(level);
    const messageId = uuidv7();
    const text = [
      protocol.title,
      protocol.message,
      ...protocol.contacts.map(
        (c) => `${c.name}${c.phone ? `: ${c.phone}` : ''}`,
      ),
    ].join('\n');
    await this.messages.storeProtocolMessage(
      session.id,
      messageId,
      text,
      protocol.version,
    );
    await releaseTurn();
    if (level === 'crisis')
      this.metrics.record('crisis_protocol_sent', { path: 'session' });
    this.emitter.emit(session.user_id, 'safety.escalation', {
      level,
      protocol,
      message_id: messageId,
      help_url: this.helpUrl,
    });
  }

  private async sessionContext(
    session: ai_sessions,
  ): Promise<SessionContextCache> {
    const key = `ctx:${session.id}`;
    const hit = await this.redis
      .getJson<SessionContextCache>(key)
      .catch(() => null);
    if (hit) return hit;
    const [profile, assessments] = await Promise.all([
      this.v3.userProfile(session.user_id).catch(() => null),
      this.assessments.forUser(session.user_id),
    ]);
    const value: SessionContextCache = {
      profile: {
        nickname: profile?.nickname ?? null,
        age_band: ageBand(profile?.birth_date ?? null),
        gender: profile?.gender ?? null,
      },
      assessments,
    };
    await this.redis
      .setJson(key, value, CONTEXT_TTL_SECONDS)
      .catch(() => undefined);
    return value;
  }

  private async offeredCards(sessionId: string): Promise<string[]> {
    return (
      (await this.redis
        .getJson<string[]>(`cards:${sessionId}`)
        .catch(() => null)) ?? []
    );
  }

  private async markOffered(sessionId: string, type: string): Promise<void> {
    const current = await this.offeredCards(sessionId);
    if (!current.includes(type)) {
      await this.redis.setJson(
        `cards:${sessionId}`,
        [...current, type],
        CARDS_TTL_SECONDS,
      );
    }
  }
}
