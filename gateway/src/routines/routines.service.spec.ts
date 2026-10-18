import type { ContentService } from '../content/content.service';
import type { PrismaService } from '../database/prisma.service';
import type { MessageCipher } from '../messages/crypto/message-cipher.service';
import { RoutinesService } from './routines.service';

const item = (refId: string, topic: string) => ({
  refId,
  version: 1,
  status: 'draft',
  body: {
    topic,
    title: `Judul ${refId}`,
    description: 'd',
    kind: 'checklist',
    time_of_day: 'any',
  },
});

describe('RoutinesService.propose', () => {
  const prisma = {
    ai_user_routines: { count: jest.fn() },
    ai_routine_proposals: { count: jest.fn(), create: jest.fn() },
  };
  const content = {
    listActive: jest.fn(() =>
      Promise.resolve([
        item('smk_a', 'rokok'),
        item('smk_b', 'rokok'),
        item('str_a', 'stres_kerja'),
      ]),
    ),
  };
  const service = new RoutinesService(
    prisma as unknown as PrismaService,
    content as unknown as ContentService,
    {} as MessageCipher,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.ai_user_routines.count.mockResolvedValue(0);
    prisma.ai_routine_proposals.count.mockResolvedValue(0);
  });

  const propose = (
    input: unknown,
    risk: 'normal' | 'elevated' | 'crisis' = 'normal',
  ) => service.propose('u1', 's1', risk, input);

  it('accepts items from the active library and snapshots them', async () => {
    const result = await propose({
      topic: 'rokok',
      items: [{ library_item_id: 'smk_a' }, { library_item_id: 'smk_b' }],
    });

    expect(result).toMatchObject({
      ok: true,
      routine: {
        topic: 'rokok',
        items: [
          { id: 'smk_a', version: 1 },
          { id: 'smk_b', version: 1 },
        ],
      },
    });
    expect(prisma.ai_routine_proposals.create).toHaveBeenCalled();
  });

  it.each([
    [
      'a fake item ID',
      { topic: 'rokok', items: [{ library_item_id: 'made_up' }] },
      'unknown_item',
    ],
    [
      'an item from another topic',
      { topic: 'rokok', items: [{ library_item_id: 'str_a' }] },
      'topic_mismatch',
    ],
    [
      'an excluded topic',
      { topic: 'alkohol', items: [{ library_item_id: 'smk_a' }] },
      'excluded_topic',
    ],
    [
      'a duplicated item',
      {
        topic: 'rokok',
        items: [{ library_item_id: 'smk_a' }, { library_item_id: 'smk_a' }],
      },
      'duplicate_item',
    ],
    [
      'more than three items',
      {
        topic: 'rokok',
        items: [1, 2, 3, 4].map((n) => ({ library_item_id: `x${n}` })),
      },
      'invalid_shape',
    ],
    ['garbage', 'not a routine', 'invalid_shape'],
  ])('rejects %s', async (_case, input, reason) => {
    await expect(propose(input)).resolves.toEqual({ ok: false, reason });
    expect(prisma.ai_routine_proposals.create).not.toHaveBeenCalled();
  });

  it.each(['elevated', 'crisis'] as const)(
    'never proposes while the session is %s',
    async (risk) => {
      await expect(
        propose(
          { topic: 'rokok', items: [{ library_item_id: 'smk_a' }] },
          risk,
        ),
      ).resolves.toEqual({ ok: false, reason: 'risk_not_normal' });
    },
  );

  it('caps active routines at two', async () => {
    prisma.ai_user_routines.count.mockResolvedValue(2);
    await expect(
      propose({ topic: 'rokok', items: [{ library_item_id: 'smk_a' }] }),
    ).resolves.toEqual({ ok: false, reason: 'too_many_active' });
  });

  it('proposes at most once per session', async () => {
    prisma.ai_routine_proposals.count.mockResolvedValue(1);
    await expect(
      propose({ topic: 'rokok', items: [{ library_item_id: 'smk_a' }] }),
    ).resolves.toEqual({ ok: false, reason: 'already_proposed' });
  });
});
