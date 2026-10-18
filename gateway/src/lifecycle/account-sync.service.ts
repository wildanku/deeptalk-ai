import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { MetricsService } from '../observability/metrics.service';
import { V3Client } from '../v3-client/v3-client.service';
import { LifecycleService } from './lifecycle.service';

const CURSOR = 'v3-account-events';
const PAGE = 200;
/**
 * Re-read this many events behind the cursor: an ID can become visible a moment after a higher
 * one (concurrent transactions in v3). Re-applying is a no-op thanks to `ai_inbound_events`.
 */
const OVERLAP = 100;

export const accountEventId = (v3Id: string): string =>
  `v3-deleted-data:${v3Id}`;

/**
 * The guarantee behind the account webhook (02 §9.3): v3 writes every account deletion and
 * merge to `deleted_data` in the same transaction as the change, and the gateway pulls that
 * feed on a schedule. The webhook is only the fast path; nothing depends on it arriving.
 */
@Injectable()
export class AccountSyncService {
  private readonly logger = new Logger(AccountSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly v3: V3Client,
    private readonly lifecycle: LifecycleService,
    private readonly metrics: MetricsService,
  ) {}

  async sync(): Promise<{ seen: number; applied: number }> {
    const stored = await this.prisma.ai_sync_cursors.findUnique({
      where: { name: CURSOR },
    });
    const cursor = BigInt(stored?.value ?? '0');
    let after = cursor > BigInt(OVERLAP) ? cursor - BigInt(OVERLAP) : 0n;
    let highest = cursor;
    let seen = 0;
    let applied = 0;
    for (;;) {
      const events = await this.v3.accountEvents(after.toString(), PAGE);
      for (const event of events) {
        const id = BigInt(event.id);
        const eventId = accountEventId(event.id);
        const result =
          event.kind === 'merge' && event.target_user_id
            ? await this.lifecycle.mergeUsers(
                event.user_id,
                event.target_user_id,
                eventId,
              )
            : await this.lifecycle.deleteUser(event.user_id, eventId);
        if (result === 'applied') applied += 1;
        seen += 1;
        after = id;
        if (id > highest) highest = id;
      }
      if (events.length < PAGE) break;
    }
    if (highest !== cursor) {
      await this.prisma.ai_sync_cursors.upsert({
        where: { name: CURSOR },
        create: { name: CURSOR, value: highest.toString() },
        update: { value: highest.toString() },
      });
    }
    if (applied > 0) this.logger.log({ account_sync: { seen, applied } });
    this.metrics.record('account_sync', { applied: String(applied) });
    return { seen, applied };
  }
}
