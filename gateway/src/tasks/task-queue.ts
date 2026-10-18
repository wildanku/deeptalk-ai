/**
 * Background work as named, scheduled HTTP tasks (02 §6.3). Production: Google Cloud Tasks, one
 * queue per name below, each calling back `POST /v1/internal/tasks/:queue` on the gateway.
 * Development and E2E: a Postgres-backed stand-in with the same semantics.
 */
export const TASK_QUEUES = [
  'ai-session-timers',
  'ai-outbox',
  'ai-lifecycle',
  'ai-evals',
  /** Local driver only: recurring jobs that Cloud Scheduler triggers in production. */
  'ai-scheduled',
] as const;
export type TaskQueueName = (typeof TASK_QUEUES)[number];

export const SESSION_TIMERS_QUEUE: TaskQueueName = 'ai-session-timers';
export const OUTBOX_QUEUE: TaskQueueName = 'ai-outbox';
export const LIFECYCLE_QUEUE: TaskQueueName = 'ai-lifecycle';
export const EVALS_QUEUE: TaskQueueName = 'ai-evals';
export const SCHEDULED_QUEUE: TaskQueueName = 'ai-scheduled';

export type TaskPayload = Record<string, string | number | boolean | null>;

export interface TaskRequest {
  /**
   * Deduplication key, like a Cloud Tasks task name: a second task with the same name is
   * dropped. Cloud Tasks keeps names of finished tasks for about an hour, so a name must never
   * be reused for a different run (include the due time or attempt).
   */
  name: string;
  payload: TaskPayload;
  /** Epoch milliseconds; omitted = now. */
  at?: number;
  /** How long one attempt may run (Cloud Tasks dispatch deadline, max 1800). */
  deadlineSeconds?: number;
}

export interface TaskQueue {
  enqueue(queue: TaskQueueName, task: TaskRequest): Promise<void>;
}

export const TASK_QUEUE = Symbol('TASK_QUEUE');

/** Cloud Tasks names allow `[A-Za-z0-9_-]`, up to 500 characters. */
export function taskName(name: string): string {
  return name.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 500);
}

export const isTaskQueue = (value: string): value is TaskQueueName =>
  (TASK_QUEUES as readonly string[]).includes(value);
