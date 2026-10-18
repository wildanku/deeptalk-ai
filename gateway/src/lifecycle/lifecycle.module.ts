import { Module, OnModuleInit } from '@nestjs/common';
import { InternalTokenGuard } from '../auth/internal-token.guard';
import { SessionsModule } from '../sessions/sessions.module';
import { TaskHandlers } from '../tasks/task-handlers';
import { LIFECYCLE_QUEUE } from '../tasks/task-queue';
import { AccountSyncService } from './account-sync.service';
import {
  HistoryController,
  LifecycleInternalController,
} from './lifecycle.controller';
import { LifecycleService } from './lifecycle.service';
import { RetentionService } from './retention.service';

/**
 * Account delete/merge from v3 (webhook + pulled feed, idempotent via `ai_inbound_events`),
 * history deletion, and retention (02 §9.3). Recurring jobs (`account-sync`, `retention`) run
 * from Cloud Scheduler in production (`POST /v1/internal/scheduler/jobs/:job`).
 */
@Module({
  imports: [SessionsModule],
  controllers: [LifecycleInternalController, HistoryController],
  providers: [
    LifecycleService,
    AccountSyncService,
    RetentionService,
    InternalTokenGuard,
  ],
  exports: [LifecycleService],
})
export class LifecycleModule implements OnModuleInit {
  constructor(
    private readonly handlers: TaskHandlers,
    private readonly sync: AccountSyncService,
    private readonly retention: RetentionService,
    private readonly lifecycle: LifecycleService,
  ) {}

  onModuleInit(): void {
    this.handlers.registerJob('account-sync', async () => {
      await this.sync.sync();
    });
    this.handlers.registerJob('retention', async () => {
      await this.retention.run();
    });
    this.handlers.register(LIFECYCLE_QUEUE, async (payload) => {
      if (payload.type === 'resweep-delete' && payload.userId) {
        await this.lifecycle.resweepDelete(String(payload.userId));
      }
      if (payload.type === 'resweep-merge' && payload.from && payload.to) {
        await this.lifecycle.resweepMerge(
          String(payload.from),
          String(payload.to),
        );
      }
    });
  }
}
