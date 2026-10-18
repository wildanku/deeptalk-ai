import { Injectable, NotFoundException } from '@nestjs/common';
import {
  SCHEDULED_QUEUE,
  type TaskPayload,
  type TaskQueueName,
} from './task-queue';

export type TaskHandler = (payload: TaskPayload) => Promise<void>;

/**
 * Who handles each queue, and each recurring job. Feature modules register in `onModuleInit`,
 * so the tasks module never depends on them.
 */
@Injectable()
export class TaskHandlers {
  private readonly queues = new Map<TaskQueueName, TaskHandler>();
  private readonly jobs = new Map<string, () => Promise<void>>();

  constructor() {
    // Local driver: recurring jobs arrive as tasks; in production Cloud Scheduler calls them.
    this.queues.set(SCHEDULED_QUEUE, (payload) =>
      this.runJob(String(payload.job)),
    );
  }

  register(queue: TaskQueueName, handler: TaskHandler): void {
    this.queues.set(queue, handler);
  }

  /** A recurring job: Cloud Scheduler → `POST /v1/internal/scheduler/jobs/:job` in production. */
  registerJob(job: string, run: () => Promise<void>): void {
    this.jobs.set(job, run);
  }

  get jobNames(): string[] {
    return [...this.jobs.keys()];
  }

  async run(queue: TaskQueueName, payload: TaskPayload): Promise<void> {
    const handler = this.queues.get(queue);
    if (!handler) throw new NotFoundException(`No handler for ${queue}`);
    await handler(payload);
  }

  async runJob(job: string): Promise<void> {
    const run = this.jobs.get(job);
    if (!run) throw new NotFoundException(`Unknown job ${job}`);
    await run();
  }
}
