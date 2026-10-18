import type { PrismaService } from '../database/prisma.service';
import type { MessageCipher } from '../messages/crypto/message-cipher.service';
import type { MetricsService } from '../observability/metrics.service';
import { ReportsService } from './reports.service';

describe('ReportsService', () => {
  const prisma = {
    ai_messages: { findFirst: jest.fn() },
    ai_message_reports: {
      upsert: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
  };
  const cipher = {
    decrypt: jest.fn().mockResolvedValue('balasan AI sintetis'),
  };
  const metrics = { record: jest.fn() };
  const service = new ReportsService(
    prisma as unknown as PrismaService,
    cipher as unknown as MessageCipher,
    metrics as unknown as MetricsService,
  );

  beforeEach(() => jest.clearAllMocks());

  it("only accepts an assistant message in one of the user's own sessions", async () => {
    prisma.ai_messages.findFirst.mockResolvedValue(null);
    await expect(service.report('u1', 'm1', 'harmful', false)).rejects.toThrow(
      'Pesan tidak ditemukan',
    );
    expect(prisma.ai_messages.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'm1', role: 'assistant', session: { user_id: 'u1' } },
      }),
    );
  });

  it('stores no user identity and is idempotent per message', async () => {
    prisma.ai_messages.findFirst.mockResolvedValue({
      id: 'm1',
      session_id: 's1',
      persona_version: 2,
      session: { persona_id: 'p1' },
    });
    await service.report('u1', 'm1', 'inaccurate', true);
    const call = prisma.ai_message_reports.upsert.mock.calls[0] as [
      { where: unknown; create: Record<string, unknown> },
    ];
    expect(call[0].where).toEqual({ message_id: 'm1' });
    expect(call[0].create).not.toHaveProperty('user_id');
    expect(call[0].create).toMatchObject({
      persona_id: 'p1',
      reason: 'inaccurate',
      share_content: true,
    });
  });

  it('shows the reply to reviewers only when the user shared it', async () => {
    prisma.ai_message_reports.findMany.mockResolvedValue([
      {
        id: 'r1',
        reason: 'harmful',
        share_content: true,
        created_at: new Date(),
        message: {
          id: 'm1',
          content_ciphertext: new Uint8Array([1]),
          model: 'x',
          prompt_version: 'y',
        },
      },
      {
        id: 'r2',
        reason: 'other',
        share_content: false,
        created_at: new Date(),
        message: {
          id: 'm2',
          content_ciphertext: new Uint8Array([1]),
          model: 'x',
          prompt_version: 'y',
        },
      },
      {
        id: 'r3',
        reason: 'other',
        share_content: true,
        created_at: new Date(),
        message: null,
      },
    ]);
    const { items } = await service.list('open');
    expect(
      items.map((i) => [i.id, i.ai_response, i.content_available]),
    ).toEqual([
      ['r1', 'balasan AI sintetis', true],
      ['r2', null, false],
      ['r3', null, false],
    ]);
    expect(cipher.decrypt).toHaveBeenCalledTimes(1);
  });
});
