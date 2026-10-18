import { describeError } from '../common/describe-error';
import { Logger } from '@nestjs/common';
import type { PrismaService } from '../database/prisma.service';
import type { Prisma } from '../generated/prisma/client';
import {
  type TaskQueue,
  type TaskQueueName,
  type TaskRequest,
  taskName,
} from './task-queue';

const POLL_MS = 250;
const BATCH = 20;
const MAX_ATTEMPTS = 20;
/** Finished names stay taken this long, like Cloud Tasks. */
const NAME_RETENTION_MS = 3_600_000;

interface ClaimedTask {
  name: string;
  queue: string;
  payload: Prisma.JsonValue;
  attempts: number;
  deadline_seconds: number;
}

export interface LocalTasksConfig {
  /** Base URL of this instance, e.g. http://127.0.0.1:8080 */
  targetUrl: string;
  token: string | undefined;
}

/**
 * Development/E2E stand-in for Cloud Tasks (`TASKS_DRIVER=local`, rejected in production).
 * Tasks live in Postgres, so they survive restarts of every instance. Each instance claims due
 * tasks with `SKIP LOCKED` and delivers them over HTTP to its own `/v1/internal/tasks/:queue`,
 * the same path Cloud Tasks calls in production. Non-2xx → retry with backoff.
 */
export class LocalTaskQueue implements TaskQueue {
  private readonly logger = new Logger(LocalTaskQueue.name);
  private timer: NodeJS.Timeout | null = null;
  private polling = false;
  private warnedNoToken = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: LocalTasksConfig,
  ) {}

  async enqueue(queue: TaskQueueName, task: TaskRequest): Promise<void> {
    // All time handling here is in SQL (epoch in, `now()` to compare): Prisma-written `Date`
    // values and the database's `now()` disagree when the server time zone is not UTC.
    const runAtMs = task.at ?? Date.now();
    await this.prisma.$executeRaw`
      INSERT INTO ai_local_tasks (name, queue, payload, run_at, deadline_seconds)
      VALUES (${taskName(task.name)}, ${queue}, ${JSON.stringify(task.payload)}::jsonb,
              to_timestamp(${runAtMs}::double precision / 1000), ${task.deadlineSeconds ?? 60})
      ON CONFLICT (name) DO NOTHING`;
  }

  start(): void {
    this.timer ??= setInterval(() => void this.poll(), POLL_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One polling round; exported for tests. */
  async poll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      const claimed = await this.prisma.$queryRaw<ClaimedTask[]>`
        UPDATE ai_local_tasks t
        SET locked_until = now() + make_interval(secs => t.deadline_seconds)
        WHERE t.name IN (
          SELECT name FROM ai_local_tasks
          WHERE done_at IS NULL AND run_at <= now()
            AND (locked_until IS NULL OR locked_until < now())
          ORDER BY run_at
          LIMIT ${BATCH}
          FOR UPDATE SKIP LOCKED)
        RETURNING t.name, t.queue, t.payload, t.attempts, t.deadline_seconds`;
      await Promise.all(claimed.map((task) => this.deliver(task)));
      await this.prisma.$executeRaw`
        DELETE FROM ai_local_tasks
        WHERE done_at < now() - make_interval(secs => ${NAME_RETENTION_MS / 1000})`;
    } catch (error) {
      this.logger.error({
        err: describeError(error),
      });
    } finally {
      this.polling = false;
    }
  }

  private async deliver(task: ClaimedTask): Promise<void> {
    if (!this.config.token && !this.warnedNoToken) {
      this.warnedNoToken = true;
      this.logger.error(
        'TASKS_TOKEN is not set: local tasks cannot be delivered',
      );
    }
    let ok = false;
    try {
      const response = await fetch(
        `${this.config.targetUrl.replace(/\/$/, '')}/v1/internal/tasks/${task.queue}`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-tasks-token': this.config.token ?? '',
          },
          body: JSON.stringify(task.payload),
          signal: AbortSignal.timeout(task.deadline_seconds * 1000),
        },
      );
      ok = response.ok;
    } catch {
      ok = false;
    }
    if (ok) {
      await this.prisma.$executeRaw`
        UPDATE ai_local_tasks SET done_at = now(), locked_until = NULL
        WHERE name = ${task.name}`;
      return;
    }
    const attempts = task.attempts + 1;
    if (attempts >= MAX_ATTEMPTS) {
      this.logger.error({ local_task: task.queue, attempts }, 'Task dropped');
      await this.prisma.$executeRaw`
        UPDATE ai_local_tasks SET done_at = now(), locked_until = NULL, attempts = ${attempts}
        WHERE name = ${task.name}`;
      return;
    }
    // Backoff 1 s, 2 s, 4 s … capped at 60 s (Cloud Tasks queues retry similarly).
    const delaySeconds = Math.min(60, 2 ** (attempts - 1));
    await this.prisma.$executeRaw`
      UPDATE ai_local_tasks
      SET attempts = ${attempts}, locked_until = NULL,
          run_at = now() + make_interval(secs => ${delaySeconds})
      WHERE name = ${task.name}`;
  }
}
