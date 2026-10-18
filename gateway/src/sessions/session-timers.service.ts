import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../config/env.schema';
import type { ai_sessions } from '../generated/prisma/client';
import { RedisService } from '../redis/redis.service';
import { TaskHandlers } from '../tasks/task-handlers';
import {
  SESSION_TIMERS_QUEUE,
  TASK_QUEUE,
  type TaskQueue,
} from '../tasks/task-queue';
import { SessionsService } from './sessions.service';

export type TimerKind = 'idle' | 'wall' | 'close';

export const turnLockKey = (sessionId: string): string => `turn:${sessionId}`;

/**
 * The reply being written for a session, if any: IDs and a time only, never content. Lets a
 * client that reloaded mid-turn show "replying" and wait for `ai.done` (02 §6.2a).
 */
export interface PendingReply {
  user_message_id: string;
  message_id: string;
  started_at: string;
}

export const turnInflightKey = (sessionId: string): string =>
  `turn:inflight:${sessionId}`;

/** Re-check interval when a close is due while a reply is still streaming. */
const BUSY_RETRY_MS = 5_000;

/**
 * Session timers as scheduled tasks (02 §6.3): Cloud Tasks in production, so they survive
 * restarts of every gateway instance and need no worker running between requests. Each task
 * re-reads the session and acts only if it is really due — an early or duplicate task just
 * reschedules, which makes them idempotent and safe across instances.
 *
 * Task names include the due time. Old idle tasks left behind by later activity fire early,
 * re-check, and reschedule to the current deadline — which dedupes to the same name.
 */
@Injectable()
export class SessionTimersService implements OnModuleInit {
  private readonly logger = new Logger(SessionTimersService.name);
  private readonly idleMs: number;
  private readonly wallMs: number;

  constructor(
    @Inject(TASK_QUEUE) private readonly queue: TaskQueue,
    private readonly handlers: TaskHandlers,
    private readonly sessions: SessionsService,
    private readonly redis: RedisService,
    config: ConfigService<Environment, true>,
  ) {
    this.idleMs =
      config.get('SESSION_IDLE_TIMEOUT_SECONDS', { infer: true }) * 1000;
    this.wallMs =
      config.get('SESSION_MAX_WALL_CLOCK_SECONDS', { infer: true }) * 1000;
  }

  onModuleInit(): void {
    this.handlers.register(SESSION_TIMERS_QUEUE, (payload) =>
      this.handle(payload.kind as TimerKind, String(payload.sessionId)),
    );
  }

  /** After every activity: push the idle deadline; make sure wall-clock/close tasks exist. */
  async touch(session: ai_sessions): Promise<void> {
    await this.schedule(
      'idle',
      session.id,
      session.last_activity_at.getTime() + this.idleMs,
    );
    await this.schedule(
      'wall',
      session.id,
      session.started_at.getTime() + this.wallMs,
    );
    if (session.closing_deadline) {
      await this.schedule(
        'close',
        session.id,
        session.closing_deadline.getTime(),
      );
    }
  }

  async handle(kind: TimerKind, sessionId: string): Promise<void> {
    const session = await this.sessions.findById(sessionId);
    if (!session || session.status === 'ended') return;
    const now = Date.now();
    const crisis = session.max_risk_level === 'crisis';

    let due: number;
    let reason: 'idle' | 'wall_clock' | 'completed';
    switch (kind) {
      case 'idle':
        due = session.last_activity_at.getTime() + this.idleMs;
        reason = 'idle';
        break;
      case 'wall':
        // Crisis sessions are exempt from time limits (02 §6.3 rule 6).
        if (crisis) return;
        due = session.started_at.getTime() + this.wallMs;
        reason = 'wall_clock';
        break;
      case 'close':
        if (crisis || session.status !== 'closing' || !session.closing_deadline)
          return;
        due = session.closing_deadline.getTime();
        reason = 'completed';
        break;
    }
    if (now < due) {
      // A task that fires a moment early must not reschedule under its own name (Cloud Tasks
      // would drop it as a duplicate), so a deadline less than a second away moves by a second.
      await this.schedule(kind, sessionId, due - now < 1000 ? due + 1000 : due);
      return;
    }
    // Never cut a reply off: wait for the running turn to finish (02 §6.3 rule 5).
    if (await this.redis.isLocked(turnLockKey(sessionId))) {
      await this.schedule(kind, sessionId, now + BUSY_RETRY_MS);
      return;
    }
    const closed = await this.sessions.close(sessionId, reason);
    if (closed) this.logger.log({ session_timer: kind, reason });
  }

  private async schedule(
    kind: TimerKind,
    sessionId: string,
    at: number,
  ): Promise<void> {
    await this.queue.enqueue(SESSION_TIMERS_QUEUE, {
      name: `${kind}-${sessionId}-${at}`,
      payload: { kind, sessionId },
      at,
    });
  }
}
