import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { OutboxService } from '../outbox/outbox.service';
import { TaskHandlers } from '../tasks/task-handlers';
import type { V3Notification } from '../v3-client/v3-client.service';
import { V3Client } from '../v3-client/v3-client.service';
import {
  localDate,
  localTime,
  minutesOf,
  type RoutineSnapshot,
} from './routine-rules';

/** Runs every 5 minutes; a reminder fires within this window after its time. */
export const REMINDER_WINDOW_MINUTES = 10;

/**
 * Routine reminders (Phase 3): scheduler (Cloud Scheduler, or the local scheduler in development)
 * → gateway → v3 `POST /internal/ai/notifications`
 * → push via the existing device registry (02 A11, T5). The text is deliberately generic so
 * nothing sensitive shows on a lock screen (02 §10.1). v3 dedupes on `notification_key`, so a
 * scheduler tick that overlaps the previous window never sends twice.
 */
@Injectable()
export class RemindersService implements OnModuleInit {
  private readonly logger = new Logger(RemindersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly v3: V3Client,
    private readonly handlers: TaskHandlers,
  ) {}

  onModuleInit(): void {
    // Also a scheduled job, so `TASKS_DRIVER=local` runs it without Cloud Scheduler.
    this.handlers.registerJob('routine-reminders', async () => {
      await this.dispatchDue();
    });
    this.outbox.register('notification', async (payload) => {
      const notifications = (
        payload as { notifications?: V3Notification[] } | null
      )?.notifications;
      if (notifications?.length) await this.v3.notify(notifications);
    });
  }

  /** Returns how many reminders were queued. */
  async dispatchDue(now = new Date()): Promise<number> {
    const routines = await this.prisma.ai_user_routines.findMany({
      where: { status: 'active', NOT: { reminder_times: { isEmpty: true } } },
      include: {
        logs: {
          where: { date: { gte: new Date(Date.now() - 2 * 86_400_000) } },
        },
      },
    });
    const notifications: V3Notification[] = [];
    for (const routine of routines) {
      const today = localDate(now, routine.timezone);
      const nowMinutes = minutesOf(localTime(now, routine.timezone));
      const snapshot = routine.routine as unknown as RoutineSnapshot;
      const doneToday = new Set(
        routine.logs
          .filter(
            (log) => log.done && log.date.toISOString().slice(0, 10) === today,
          )
          .map((log) => log.item_id),
      );
      // Everything already done today → no nudge.
      if (snapshot.items.every((item) => doneToday.has(item.id))) continue;
      for (const time of routine.reminder_times) {
        const delta = nowMinutes - minutesOf(time);
        if (delta < 0 || delta >= REMINDER_WINDOW_MINUTES) continue;
        notifications.push({
          notification_key: `ai-routine:${routine.id}:${today}:${time}`,
          audience: 'user',
          recipient_id: routine.user_id,
          title: 'DeepTalk AI',
          body: 'Waktunya routine harianmu.',
          data: { feature: 'teman_ai_routine', routine_id: routine.id },
        });
      }
    }
    if (notifications.length === 0) return 0;
    const id = await this.outbox.add('notification', {
      notifications: notifications as unknown as never,
    });
    await this.outbox.dispatch(id);
    this.logger.log({ reminders_queued: notifications.length });
    return notifications.length;
  }
}
