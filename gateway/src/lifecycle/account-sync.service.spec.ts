import type { PrismaService } from '../database/prisma.service';
import type { MetricsService } from '../observability/metrics.service';
import type { V3Client } from '../v3-client/v3-client.service';
import { AccountSyncService } from './account-sync.service';
import type { LifecycleService } from './lifecycle.service';

describe('AccountSyncService', () => {
  const prisma = {
    ai_sync_cursors: { findUnique: jest.fn(), upsert: jest.fn() },
  };
  const v3 = { accountEvents: jest.fn() };
  const lifecycle = { deleteUser: jest.fn(), mergeUsers: jest.fn() };
  const service = new AccountSyncService(
    prisma as unknown as PrismaService,
    v3 as unknown as V3Client,
    lifecycle as unknown as LifecycleService,
    { record: jest.fn() } as unknown as MetricsService,
  );

  beforeEach(() => jest.clearAllMocks());

  it('re-reads behind the cursor, applies each event once, and advances', async () => {
    prisma.ai_sync_cursors.findUnique.mockResolvedValue({ value: '250' });
    v3.accountEvents.mockResolvedValue([
      { id: '249', kind: 'delete', user_id: 'U1', target_user_id: null },
      { id: '260', kind: 'merge', user_id: 'U2', target_user_id: 'U3' },
    ]);
    lifecycle.deleteUser.mockResolvedValue('duplicate');
    lifecycle.mergeUsers.mockResolvedValue('applied');

    await expect(service.sync()).resolves.toEqual({ seen: 2, applied: 1 });
    expect(v3.accountEvents).toHaveBeenCalledWith('150', 200);
    expect(lifecycle.deleteUser).toHaveBeenCalledWith(
      'U1',
      'v3-deleted-data:249',
    );
    expect(lifecycle.mergeUsers).toHaveBeenCalledWith(
      'U2',
      'U3',
      'v3-deleted-data:260',
    );
    expect(prisma.ai_sync_cursors.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { value: '260' } }),
    );
  });

  it('starts from zero and keeps the cursor when nothing is new', async () => {
    prisma.ai_sync_cursors.findUnique.mockResolvedValue(null);
    v3.accountEvents.mockResolvedValue([]);
    await service.sync();
    expect(v3.accountEvents).toHaveBeenCalledWith('0', 200);
    expect(prisma.ai_sync_cursors.upsert).not.toHaveBeenCalled();
  });
});
