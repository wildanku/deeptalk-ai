import type { CloudTasksClient } from '@google-cloud/tasks';
import {
  type TaskQueue,
  type TaskQueueName,
  type TaskRequest,
  taskName,
} from './task-queue';

/** gRPC ALREADY_EXISTS: a task with this name exists or ran recently — the dedupe we want. */
const ALREADY_EXISTS = 6;

export interface CloudTasksConfig {
  project: string;
  location: string;
  /** The gateway's own base URL, e.g. https://gateway-…a.run.app */
  targetUrl: string;
  token: string;
}

/**
 * Google Cloud Tasks (production). Each task is an HTTP POST back to the gateway with the
 * payload as JSON and the `x-tasks-token` header; retries and rate limits are queue settings
 * (docs: deployment topology). Payloads are IDs only — never conversation content.
 */
export class CloudTasksQueue implements TaskQueue {
  constructor(
    private readonly client: Pick<CloudTasksClient, 'createTask' | 'queuePath'>,
    private readonly config: CloudTasksConfig,
  ) {}

  async enqueue(queue: TaskQueueName, task: TaskRequest): Promise<void> {
    const parent = this.client.queuePath(
      this.config.project,
      this.config.location,
      queue,
    );
    try {
      await this.client.createTask({
        parent,
        task: {
          name: `${parent}/tasks/${taskName(task.name)}`,
          scheduleTime:
            task.at === undefined
              ? undefined
              : {
                  seconds: Math.floor(task.at / 1000),
                  nanos: (task.at % 1000) * 1_000_000,
                },
          dispatchDeadline:
            task.deadlineSeconds === undefined
              ? undefined
              : { seconds: task.deadlineSeconds },
          httpRequest: {
            httpMethod: 'POST',
            url: `${this.config.targetUrl.replace(/\/$/, '')}/v1/internal/tasks/${queue}`,
            headers: {
              'Content-Type': 'application/json',
              'x-tasks-token': this.config.token,
            },
            body: Buffer.from(JSON.stringify(task.payload)),
          },
        },
      });
    } catch (error) {
      if ((error as { code?: number }).code === ALREADY_EXISTS) return;
      throw error;
    }
  }
}
