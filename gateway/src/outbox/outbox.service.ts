import { describeError } from '../common/describe-error';
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { uuidv7 } from 'uuidv7';
import { PrismaService } from '../database/prisma.service';
import type { Prisma } from '../generated/prisma/client';
import { TaskHandlers } from '../tasks/task-handlers';
import { OUTBOX_QUEUE, TASK_QUEUE, type TaskQueue } from '../tasks/task-queue';

export type OutboxKind = 'session_summary' | 'notification';

export type OutboxHandler = (payload: Prisma.JsonValue) => Promise<void>;

type TransactionClient = Prisma.TransactionClient;

const MAX_ATTEMPTS = 8;

/**
 * Transactional outbox (02 §8): a row is written in the same transaction as the change that
 * causes it, then processed by a task. A sweep every minute (Cloud Scheduler job
 * `outbox-sweep`) re-enqueues rows whose task was lost (crash between commit and enqueue).
 * Payloads are IDs and metadata only — never content.
 */
@Injectable()
export class OutboxService implements OnModuleInit {
  private readonly logger = new Logger(OutboxService.name);
  private readonly handlers = new Map<OutboxKind, OutboxHandler>();

  constructor(
    private readonly prisma: PrismaService,
    @Inject(TASK_QUEUE) private readonly queue: TaskQueue,
    private readonly tasks: TaskHandlers,
  ) {}

  onModuleInit(): void {
    this.tasks.register(OUTBOX_QUEUE, (payload) =>
      this.process(String(payload.id)),
    );
    this.tasks.registerJob('outbox-sweep', () => this.sweep());
  }

  register(kind: OutboxKind, handler: OutboxHandler): void {
    this.handlers.set(kind, handler);
  }

  /** Writes the row (inside `tx` when given). Call `dispatch` with the ID after commit. */
  async add(
    kind: OutboxKind,
    payload: Prisma.InputJsonValue,
    tx?: TransactionClient,
  ): Promise<string> {
    const id = uuidv7();
    await (tx ?? this.prisma).ai_outbox.create({ data: { id, kind, payload } });
    return id;
  }

  /** `attempts` keeps task names unique per retry (finished names stay taken for an hour). */
  async dispatch(id: string, attempts = 0): Promise<void> {
    await this.queue
      .enqueue(OUTBOX_QUEUE, {
        name: `outbox-${id}-a${attempts}`,
        payload: { id },
      })
      .catch((error: unknown) =>
        // The sweep picks it up; never fail the caller's request over this.
        this.logger.warn({
          err: describeError(error),
        }),
      );
  }

  async process(id: string): Promise<void> {
    const claimed = await this.prisma.ai_outbox.updateMany({
      where: { id, status: 'pending', available_at: { lte: new Date() } },
      data: { status: 'processing', attempts: { increment: 1 } },
    });
    if (claimed.count === 0) return;
    const row = await this.prisma.ai_outbox.findUniqueOrThrow({
      where: { id },
    });
    const handler = this.handlers.get(row.kind as OutboxKind);
    try {
      if (!handler) throw new Error(`No outbox handler for ${row.kind}`);
      await handler(row.payload);
      await this.prisma.ai_outbox.update({
        where: { id },
        data: { status: 'done' },
      });
    } catch (error) {
      const failed = row.attempts >= MAX_ATTEMPTS;
      // Exponential backoff: 30 s, 1 min, 2 min, … capped at 1 h.
      const delayMs = Math.min(3_600_000, 30_000 * 2 ** (row.attempts - 1));
      await this.prisma.ai_outbox.update({
        where: { id },
        data: {
          status: failed ? 'failed' : 'pending',
          available_at: new Date(Date.now() + delayMs),
        },
      });
      this.logger.warn({
        outbox: row.kind,
        attempts: row.attempts,
        failed,
        err: describeError(error),
      });
    }
  }

  /** Re-enqueues due rows and rows stuck in `processing` (instance died mid-job). */
  async sweep(): Promise<void> {
    const stuckBefore = new Date(Date.now() - 5 * 60_000);
    await this.prisma.ai_outbox.updateMany({
      where: { status: 'processing', updated_at: { lt: stuckBefore } },
      data: { status: 'pending' },
    });
    const due = await this.prisma.ai_outbox.findMany({
      where: { status: 'pending', available_at: { lte: new Date() } },
      select: { id: true, attempts: true },
      take: 200,
    });
    for (const row of due) await this.dispatch(row.id, row.attempts);
  }
}
