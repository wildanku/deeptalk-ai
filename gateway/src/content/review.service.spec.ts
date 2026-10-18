import type { PrismaService } from '../database/prisma.service';
import type { ContentService } from './content.service';
import { isEngineeringSeed, ReviewService } from './review.service';

const row = (over: Record<string, unknown> = {}) => ({
  id: 'v1',
  kind: 'protocol',
  ref_id: 'crisis',
  version: 2,
  body: {},
  status: 'in_review',
  author_id: 'psy-author',
  approved_by: null,
  approved_at: null,
  submitted_at: null,
  reviewed_by: null,
  reviewed_at: null,
  review_notes: null,
  created_at: new Date('2026-10-10T00:00:00Z'),
  ...over,
});

describe('ReviewService', () => {
  const tx = {
    ai_content_versions: {
      updateMany: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
  };
  const prisma = {
    $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
    ai_content_versions: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
  };
  const content = { invalidate: jest.fn() };
  const service = new ReviewService(
    prisma as unknown as PrismaService,
    content as unknown as ContentService,
  );

  beforeEach(() => jest.clearAllMocks());

  it('never approves an engineering seed', async () => {
    prisma.ai_content_versions.findUnique.mockResolvedValue(
      row({ author_id: 'seed:content' }),
    );
    await expect(
      service.approve('protocol', 'crisis', 2, 'psy-reviewer'),
    ).rejects.toMatchObject({ response: { code: 'ENGINEERING_SEED' } });
    expect(isEngineeringSeed(null)).toBe(true);
  });

  it('requires a second person to approve (four eyes)', async () => {
    prisma.ai_content_versions.findUnique.mockResolvedValue(row());
    await expect(
      service.approve('protocol', 'crisis', 2, 'psy-author'),
    ).rejects.toMatchObject({ response: { code: 'SELF_APPROVAL' } });
  });

  it('approves, retires the previous approved version, and drops the cache', async () => {
    prisma.ai_content_versions.findUnique.mockResolvedValue(row());
    tx.ai_content_versions.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });
    tx.ai_content_versions.findUniqueOrThrow.mockResolvedValue(
      row({
        status: 'approved',
        approved_by: 'psy-reviewer',
        approved_at: new Date(),
      }),
    );
    const result = await service.approve(
      'protocol',
      'crisis',
      2,
      'psy-reviewer',
    );
    expect(result.status).toBe('approved');
    expect(tx.ai_content_versions.updateMany).toHaveBeenNthCalledWith(1, {
      where: { id: 'v1', status: 'in_review' },
      data: expect.objectContaining({
        status: 'approved',
        approved_by: 'psy-reviewer',
      }) as unknown,
    });
    expect(tx.ai_content_versions.updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        kind: 'protocol',
        ref_id: 'crisis',
        status: 'approved',
        NOT: { id: 'v1' },
      },
      data: { status: 'retired' },
    });
    expect(content.invalidate).toHaveBeenCalled();
  });

  it('refuses persona cards and unknown kinds (owner flow only)', async () => {
    await expect(service.versions('persona_card', 'x')).rejects.toThrow(
      'Jenis konten tidak dikenal',
    );
  });

  it('validates the body and cross-field rules before creating a version', async () => {
    await expect(
      service.create('assessment_mapping', 'kecemasan', { topic: 'x' }, 'psy'),
    ).rejects.toMatchObject({ response: { code: 'CONTENT_INVALID' } });

    prisma.ai_content_versions.findFirst.mockResolvedValue({ version: 1 });
    await expect(
      service.create(
        'assessment_mapping',
        'kecemasan',
        { topic: 'tidur', assessment_product_ids: ['A1'] },
        'psy',
      ),
    ).rejects.toThrow('topic harus sama dengan ref_id');

    await expect(
      service.create(
        'consent_text',
        'service',
        {
          type: 'service',
          title: 'T',
          summary: ['S'],
          body: 'B',
          min_accepted_version: 5,
        },
        'psy',
      ),
    ).rejects.toThrow('min_accepted_version');
  });

  it('creates the next version as a draft by its author', async () => {
    prisma.ai_content_versions.findFirst.mockResolvedValue({ version: 3 });
    prisma.ai_content_versions.create.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve(row({ ...data, status: 'draft' })),
    );
    const created = await service.create(
      'assessment_mapping',
      'kecemasan',
      { topic: 'kecemasan', assessment_product_ids: ['A1'] },
      'psy',
    );
    expect(created).toMatchObject({
      version: 4,
      status: 'draft',
      author_id: 'psy',
    });
  });
});
