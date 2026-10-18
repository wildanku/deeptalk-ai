import { withdrawItems } from '../datasets/withdraw';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  ACCOUNT_GONE_TTL_SECONDS,
  accountGoneKey,
} from '../auth/ai-token-verifier.service';
import { UserEmitter } from '../common/emitter/user-emitter.service';
import { PrismaService } from '../database/prisma.service';
import type { Prisma } from '../generated/prisma/client';
import { MetricsService } from '../observability/metrics.service';
import { RedisService } from '../redis/redis.service';
import { SessionsService } from '../sessions/sessions.service';
import {
  LIFECYCLE_QUEUE,
  TASK_QUEUE,
  type TaskQueue,
} from '../tasks/task-queue';

type Tx = Prisma.TransactionClient;

export type ApplyResult = 'applied' | 'duplicate';

/** Writes already in flight (a summary job, a reply) can land after the purge; sweep again. */
const RESWEEP_DELAY_MS = 120_000;

/**
 * Account lifecycle (02 §9.3): v3 deletes or merges an account → the gateway removes or moves
 * every row. Each event is applied once (`ai_inbound_events`, in the same transaction), and
 * a second, delayed sweep catches writes that were already in flight.
 *
 * Kept after an account is deleted: `ai_safety_events` without their session (content-free and
 * no longer tied to anyone) — pending the retention decision (Q10).
 */
@Injectable()
export class LifecycleService {
  private readonly logger = new Logger(LifecycleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionsService,
    private readonly redis: RedisService,
    private readonly emitter: UserEmitter,
    private readonly metrics: MetricsService,
    @Inject(TASK_QUEUE) private readonly queue: TaskQueue,
  ) {}

  async deleteUser(userId: string, eventId: string): Promise<ApplyResult> {
    const purged = await this.prisma.$transaction(async (tx) => {
      if (!(await claim(tx, eventId, 'user_delete'))) return null;
      return purgeUser(tx, userId);
    });
    if (purged === null) return 'duplicate';
    await this.afterUserGone(userId, purged.sessionIds);
    // Nothing stored → nothing can be in flight either.
    if (purged.rows > 0) {
      await this.resweep('delete', eventId, { userId });
      this.metrics.record('account_deleted', {});
    }
    return 'applied';
  }

  /** Same purge without the idempotency claim (the delayed sweep). */
  async resweepDelete(userId: string): Promise<void> {
    const { sessionIds } = await this.prisma.$transaction((tx) =>
      purgeUser(tx, userId),
    );
    await this.afterUserGone(userId, sessionIds);
  }

  /**
   * Moves everything from `from` to `to` (02 §9.3). The quota is a count of the month's
   * sessions, so it is recomputed by the move itself. Memory stays on only if both accounts
   * had it on — the more private choice wins.
   */
  async mergeUsers(
    from: string,
    to: string,
    eventId: string,
  ): Promise<ApplyResult> {
    if (from === to) return 'duplicate';
    const result = await this.prisma.$transaction(async (tx) => {
      if (!(await claim(tx, eventId, 'user_merge'))) return null;
      return moveUser(tx, from, to);
    });
    if (result === null) return 'duplicate';
    for (const sessionId of result.endedSessionIds) {
      this.emitter.emit(to, 'session.ended', {
        session_id: sessionId,
        reason: 'completed',
        quota: await this.sessions.quota(to),
        consent_offer: null,
      });
    }
    await this.afterUserGone(from, []);
    await this.resweep('merge', eventId, { from, to });
    this.metrics.record('account_merged', {});
    return 'applied';
  }

  async resweepMerge(from: string, to: string): Promise<void> {
    await this.prisma.$transaction((tx) => moveUser(tx, from, to));
  }

  /**
   * `DELETE /v1/me/history` (02 §9.3): the running session ends, then every message, summary,
   * routine proposal, and unshared handoff is deleted. Session rows stay without content —
   * they are the monthly quota. Routines stay (a separate feature with its own stop button),
   * and so do summaries already shared with a psikolog for a booking.
   */
  async deleteHistory(userId: string): Promise<void> {
    const active = await this.sessions.findActive(userId);
    if (active)
      await this.sessions.close(active.id, 'completed', { summarize: false });
    const sessionIds = await this.prisma.$transaction(async (tx) => {
      const ids = await lockSessions(tx, userId);
      await tx.ai_messages.deleteMany({ where: { session_id: { in: ids } } });
      await tx.ai_session_summaries.deleteMany({ where: { user_id: userId } });
      await tx.ai_routine_proposals.deleteMany({ where: { user_id: userId } });
      // Which assessment or psikolog was suggested reveals the conversation's topic.
      await tx.ai_assessment_referrals.deleteMany({
        where: { user_id: userId },
      });
      await tx.ai_psikolog_recommendations.deleteMany({
        where: { user_id: userId },
      });
      // Dataset copies of these conversations follow the history (Phase 9).
      await withdrawItems(tx, { user_id: userId, source: 'teman_ai' });
      await tx.ai_handoffs.deleteMany({
        where: {
          user_id: userId,
          status: {
            in: ['draft', 'approved', 'declined', 'pending_confirmation'],
          },
        },
      });
      await tx.ai_sessions.updateMany({
        where: { user_id: userId },
        data: { topics: [], router_reason: null },
      });
      await deleteOutboxFor(tx, ids, null);
      return ids;
    });
    await this.dropSessionCaches(sessionIds);
    this.metrics.record('history_deleted', {});
  }

  private async afterUserGone(
    userId: string,
    sessionIds: string[],
  ): Promise<void> {
    await Promise.all([
      // Tokens issued before the deletion are refused from now on (AiTokenVerifier).
      this.redis.setJson(
        accountGoneKey(userId),
        true,
        ACCOUNT_GONE_TTL_SECONDS,
      ),
      this.redis.del(`pending-persona:${userId}`),
      this.redis.del(`rate:${userId}`),
    ]).catch(() => undefined);
    await this.dropSessionCaches(sessionIds);
    this.emitter.disconnect(userId);
  }

  private async dropSessionCaches(sessionIds: string[]): Promise<void> {
    await Promise.all(
      sessionIds.flatMap((id) => [
        this.redis.del(`ctx:${id}`),
        this.redis.del(`cards:${id}`),
      ]),
    ).catch(() => undefined);
  }

  private async resweep(
    kind: 'delete' | 'merge',
    eventId: string,
    data: Record<string, string>,
  ): Promise<void> {
    await this.queue
      .enqueue(LIFECYCLE_QUEUE, {
        // One resweep per account event (`taskName` makes the event ID a valid task name).
        name: `resweep-${kind}-${eventId}`,
        payload: { type: `resweep-${kind}`, ...data },
        at: Date.now() + RESWEEP_DELAY_MS,
      })
      .catch(() =>
        this.logger.warn({ lifecycle: kind }, 'Could not schedule resweep'),
      );
  }
}

/** `false` when the event was already applied. */
async function claim(tx: Tx, eventId: string, kind: string): Promise<boolean> {
  const { count } = await tx.ai_inbound_events.createMany({
    data: [{ event_id: eventId, kind }],
    skipDuplicates: true,
  });
  return count === 1;
}

/**
 * Locks the user's sessions first, so a summary being written concurrently either commits
 * before this transaction (and is deleted by it) or sees the change and writes nothing.
 */
async function lockSessions(tx: Tx, userId: string): Promise<string[]> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM ai_sessions WHERE user_id = ${userId} FOR UPDATE`;
  return rows.map((row) => row.id);
}

/**
 * Every row of a user. Messages go with their sessions (cascade); safety events lose theirs.
 * `rows` is 0 for someone who never used Teman AI (most v3 deletions).
 */
async function purgeUser(
  tx: Tx,
  userId: string,
): Promise<{ sessionIds: string[]; rows: number }> {
  const sessionIds = await lockSessions(tx, userId);
  const where = { user_id: userId };
  const counts = [
    await tx.ai_user_routines.deleteMany({ where }),
    await tx.ai_routine_proposals.deleteMany({ where }),
    await tx.ai_handoffs.deleteMany({ where }),
    await tx.ai_session_summaries.deleteMany({ where }),
    await tx.ai_consents.deleteMany({ where }),
    await tx.ai_assessment_referrals.deleteMany({ where }),
    await tx.ai_psikolog_recommendations.deleteMany({ where }),
    await tx.ai_instrument_responses.deleteMany({ where }),
    // Phase 9: every dataset copy goes too, exported or not; export counts stay in
    // `ai_dataset_exports` without user IDs.
    await tx.ai_dataset_items.deleteMany({ where }),
    await tx.ai_sessions.deleteMany({ where }),
    await tx.ai_user_state.deleteMany({ where }),
  ];
  await deleteOutboxFor(tx, sessionIds, userId);
  return {
    sessionIds,
    rows: counts.reduce((sum, { count }) => sum + count, 0),
  };
}

/** Pending outbox rows that would recreate or deliver the user's data. */
async function deleteOutboxFor(
  tx: Tx,
  sessionIds: string[],
  recipientUserId: string | null,
): Promise<void> {
  if (sessionIds.length > 0) {
    await tx.$executeRaw`
      DELETE FROM ai_outbox
      WHERE status <> 'processing' AND payload->>'session_id' = ANY(${sessionIds}::text[])`;
  }
  if (recipientUserId) {
    const match = JSON.stringify({
      notifications: [{ audience: 'user', recipient_id: recipientUserId }],
    });
    await tx.$executeRaw`
      DELETE FROM ai_outbox
      WHERE status <> 'processing' AND payload @> ${match}::jsonb`;
  }
}

async function moveUser(
  tx: Tx,
  from: string,
  to: string,
): Promise<{ endedSessionIds: string[] }> {
  for (const id of [from, to].sort()) {
    await tx.$executeRaw`
      INSERT INTO ai_user_state (user_id, updated_at) VALUES (${id}, now())
      ON CONFLICT (user_id) DO NOTHING`;
  }
  // Fixed order, so a concurrent merge in the other direction cannot deadlock.
  const states = await tx.$queryRaw<
    { user_id: string; memory_enabled: boolean; last_session_at: Date | null }[]
  >`
    SELECT user_id, memory_enabled, last_session_at FROM ai_user_state
    WHERE user_id IN (${from}, ${to}) ORDER BY user_id FOR UPDATE`;
  const source = states.find((row) => row.user_id === from);
  const target = states.find((row) => row.user_id === to);

  // One open session per user: if both have one, the source's ends.
  const targetOpen = await tx.ai_sessions.count({
    where: { user_id: to, status: { in: ['active', 'closing'] } },
  });
  const endedSessionIds: string[] = [];
  if (targetOpen > 0) {
    const open = await tx.ai_sessions.findMany({
      where: { user_id: from, status: { in: ['active', 'closing'] } },
      select: { id: true },
    });
    for (const session of open) {
      await tx.ai_sessions.update({
        where: { id: session.id },
        data: {
          status: 'ended',
          end_reason: 'completed',
          ended_at: new Date(),
        },
      });
      endedSessionIds.push(session.id);
    }
  }

  const where = { user_id: from };
  const data = { user_id: to };
  await tx.ai_sessions.updateMany({ where, data });
  await tx.ai_session_summaries.updateMany({ where, data });
  await tx.ai_routine_proposals.updateMany({ where, data });
  await tx.ai_user_routines.updateMany({ where, data });
  await tx.ai_handoffs.updateMany({ where, data });
  await tx.ai_consents.updateMany({ where, data });
  await tx.ai_assessment_referrals.updateMany({ where, data });
  await tx.ai_psikolog_recommendations.updateMany({ where, data });
  // One answer per instrument per day: on a clash the surviving account's answer stays.
  await tx.$executeRaw`
    DELETE FROM ai_instrument_responses f USING ai_instrument_responses t
    WHERE f.user_id = ${from} AND t.user_id = ${to}
      AND f.instrument_ref = t.instrument_ref AND f.local_date = t.local_date`;
  await tx.ai_instrument_responses.updateMany({ where, data });
  await tx.ai_dataset_items.updateMany({ where, data });

  const memoryEnabled =
    (source?.memory_enabled ?? true) && (target?.memory_enabled ?? true);
  const lastSession = [source?.last_session_at, target?.last_session_at]
    .filter((value): value is Date => value instanceof Date)
    .sort((a, b) => b.getTime() - a.getTime())[0];
  await tx.ai_user_state.update({
    where: { user_id: to },
    // The age check is redone against the surviving v3 account.
    data: {
      memory_enabled: memoryEnabled,
      last_session_at: lastSession ?? null,
      age_band: null,
      age_checked_at: null,
    },
  });
  if (!memoryEnabled) {
    await tx.ai_session_summaries.deleteMany({ where: { user_id: to } });
  }
  await tx.ai_user_state.deleteMany({ where: { user_id: from } });
  return { endedSessionIds };
}
