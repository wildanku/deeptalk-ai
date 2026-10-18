import { describeError } from '../common/describe-error';
import {
  BadRequestException,
  Body,
  Controller,
  Global,
  HttpCode,
  Inject,
  Injectable,
  Logger,
  Module,
  OnApplicationBootstrap,
  OnModuleDestroy,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  InternalCaller,
  InternalTokenGuard,
} from '../auth/internal-token.guard';
import type { Environment } from '../config/env.schema';
import { localDate, localTime } from '../routines/routine-rules';
import { PrismaService } from '../database/prisma.service';
import { CloudTasksQueue } from './cloud-tasks.queue';
import { LocalTaskQueue } from './local-task.queue';
import { TaskHandlers } from './task-handlers';
import {
  isTaskQueue,
  SCHEDULED_QUEUE,
  TASK_QUEUE,
  type TaskPayload,
  type TaskQueue,
} from './task-queue';

/** Delivery from Cloud Tasks (or the local driver). Non-2xx → the queue retries. */
@Controller('internal')
@UseGuards(InternalTokenGuard)
export class TasksController {
  constructor(private readonly handlers: TaskHandlers) {}

  @Post('tasks/:queue')
  @InternalCaller('tasks')
  @HttpCode(204)
  async run(
    @Param('queue') queue: string,
    @Body() payload: TaskPayload,
  ): Promise<void> {
    if (!isTaskQueue(queue)) throw new BadRequestException('Unknown queue');
    await this.handlers.run(queue, payload ?? {});
  }

  /** Cloud Scheduler: outbox sweep, account sync, retention (deployment topology doc). */
  @Post('scheduler/jobs/:job')
  @InternalCaller('scheduler')
  @HttpCode(204)
  async job(@Param('job') job: string): Promise<void> {
    await this.handlers.runJob(job);
  }
}

/**
 * Local driver only: the recurring jobs Cloud Scheduler runs in production. Each period gets one
 * deterministic task name, so with several instances the job still runs once per period.
 */
@Injectable()
export class LocalScheduler implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(LocalScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private readonly last = new Map<string, string>();

  constructor(
    @Inject(TASK_QUEUE) private readonly queue: TaskQueue,
    private readonly config: ConfigService<Environment, true>,
  ) {}

  onApplicationBootstrap(): void {
    if (!(this.queue instanceof LocalTaskQueue)) return;
    this.queue.start();
    this.timer = setInterval(() => void this.tick(), 1000);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.queue instanceof LocalTaskQueue) this.queue.stop();
  }

  /** Period keys per job; a new key enqueues one run. Exported for tests. */
  periods(now: Date): Record<string, string | null> {
    const zone = this.config.get('DEFAULT_TIMEZONE', { infer: true });
    const syncMs =
      this.config.get('ACCOUNT_SYNC_INTERVAL_SECONDS', { infer: true }) * 1000;
    const today = localDate(now, zone);
    return {
      'outbox-sweep': String(Math.floor(now.getTime() / 60_000)),
      'account-sync': String(Math.floor(now.getTime() / syncMs)),
      // Every 5 minutes, like the Cloud Scheduler job (REMINDER_WINDOW_MINUTES covers overlap).
      'routine-reminders': String(Math.floor(now.getTime() / 300_000)),
      // Daily at 03:00 local time, like the production Cloud Scheduler job.
      retention: localTime(now, zone) >= '03:00' ? today : null,
    };
  }

  private async tick(): Promise<void> {
    for (const [job, period] of Object.entries(this.periods(new Date()))) {
      if (!period || this.last.get(job) === period) continue;
      try {
        await this.queue.enqueue(SCHEDULED_QUEUE, {
          name: `scheduled-${job}-${period}`,
          payload: { job },
        });
        this.last.set(job, period);
      } catch (error) {
        this.logger.warn({
          err: describeError(error),
        });
      }
    }
  }
}

/**
 * Background work (02 §6.3): Cloud Tasks in production, a Postgres stand-in locally.
 * Feature modules inject `TASK_QUEUE` to enqueue and `TaskHandlers` to register handlers.
 */
@Global()
@Module({
  controllers: [TasksController],
  providers: [
    TaskHandlers,
    InternalTokenGuard,
    LocalScheduler,
    {
      provide: TASK_QUEUE,
      inject: [ConfigService, PrismaService],
      useFactory: async (
        config: ConfigService<Environment, true>,
        prisma: PrismaService,
      ): Promise<TaskQueue> => {
        const token = config.get('TASKS_TOKEN', { infer: true });
        if (config.get('TASKS_DRIVER', { infer: true }) === 'cloud') {
          // Loaded lazily so local development never initialises GCP libraries.
          const { CloudTasksClient } = await import('@google-cloud/tasks');
          return new CloudTasksQueue(new CloudTasksClient(), {
            project: config.get('GOOGLE_CLOUD_PROJECT', { infer: true }) ?? '',
            location: config.get('TASKS_LOCATION', { infer: true }),
            targetUrl: config.get('TASKS_TARGET_URL', { infer: true }) ?? '',
            token: token ?? '',
          });
        }
        return new LocalTaskQueue(prisma, {
          targetUrl:
            config.get('TASKS_TARGET_URL', { infer: true }) ??
            `http://127.0.0.1:${config.get('PORT', { infer: true })}`,
          token,
        });
      },
    },
  ],
  exports: [TASK_QUEUE, TaskHandlers],
})
export class TasksModule {}
