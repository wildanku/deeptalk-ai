import type { ConfigService } from '@nestjs/config';
import type { Environment } from '../config/env.schema';
import type { ConsentsService } from '../consents/consents.service';
import type { PrismaService } from '../database/prisma.service';
import type { MessageCipher } from '../messages/crypto/message-cipher.service';
import { DatasetsService } from './datasets.service';
import { LocalDeidentifier } from './deid';
import { assertOpen, gateStates } from './gates';
import type { PsikologDataConsentService } from './psikolog-data-consent.service';

const at = (iso: string) => new Date(iso);
const gate = (
  name: 'dpia' | 'ethics_review' | 'fine_tuning_go',
  approved = true,
  when = '2026-10-01T00:00:00Z',
) => ({
  gate: name,
  approved,
  recorded_by: 'hukum',
  reference: 'DOC-1',
  created_at: at(when),
});

describe('gates', () => {
  it('uses the newest row per gate; revoking closes it', () => {
    const states = gateStates([
      gate('dpia', true, '2026-10-01T00:00:00Z'),
      gate('dpia', false, '2026-10-02T00:00:00Z'),
      gate('ethics_review'),
    ]);
    expect(states.map((s) => [s.gate, s.approved])).toEqual([
      ['dpia', false],
      ['ethics_review', true],
      ['fine_tuning_go', false],
    ]);
  });

  it('names everything missing, the switch included', () => {
    expect(() => assertOpen(false, gateStates([]), ['dpia'])).toThrow(
      expect.objectContaining({
        missing: ['DATASET_ENABLED', 'dpia'],
      }) as Error,
    );
    expect(() =>
      assertOpen(true, gateStates([gate('dpia'), gate('ethics_review')]), [
        'dpia',
        'ethics_review',
      ]),
    ).not.toThrow();
  });
});

describe('DatasetsService', () => {
  const sealed = (aad: string, text: string) => Buffer.from(`${aad}|${text}`);
  const prisma = {
    ai_data_gates: { findMany: jest.fn() },
    ai_dataset_items: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      deleteMany: jest.fn(() => ({ count: 0 })),
      updateMany: jest.fn(() => ({ count: 0 })),
    },
    ai_dataset_exports: { create: jest.fn() },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) =>
    fn(prisma),
  );
  const cipher = {
    encrypt: jest.fn((text: string, aad: string) =>
      Promise.resolve(sealed(aad, text)),
    ),
    decrypt: jest.fn((data: Uint8Array, aad: string) =>
      Promise.resolve(
        Buffer.from(data)
          .toString()
          .slice(aad.length + 1),
      ),
    ),
  };
  const consents = {
    trainingActive: jest.fn(() => Promise.resolve(true)),
    state: jest.fn(() => Promise.resolve({ granted: true })),
  };
  const psikologs = {
    allows: jest.fn(() => Promise.resolve(true)),
    allowsAny: jest.fn(() => Promise.resolve(true)),
  };
  const make = (enabled = true, min = 2) =>
    new DatasetsService(
      prisma as unknown as PrismaService,
      cipher as unknown as MessageCipher,
      consents as unknown as ConsentsService,
      psikologs as unknown as PsikologDataConsentService,
      new LocalDeidentifier(),
      {
        get: (key: string) =>
          key === 'DATASET_ENABLED'
            ? enabled
            : key === 'DATASET_MIN_FINE_TUNING_ITEMS'
              ? min
              : undefined,
      } as unknown as ConfigService<Environment, true>,
    );

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.ai_data_gates.findMany.mockResolvedValue([
      gate('dpia'),
      gate('ethics_review'),
    ]);
    prisma.ai_dataset_items.findUnique.mockResolvedValue(null);
    consents.trainingActive.mockResolvedValue(true);
    consents.state.mockResolvedValue({ granted: true });
    psikologs.allows.mockResolvedValue(true);
    psikologs.allowsAny.mockResolvedValue(true);
  });

  const legacy = (id: string, text = 'aku Rani, nomorku 081234567890') => ({
    conversation_id: id,
    user_id: `u-${id}`,
    psychologist_id: 'PSY-1',
    messages: [
      { role: 'user', text },
      { role: 'psikolog', text: 'terima kasih sudah cerita' },
    ],
  });

  it('refuses every job while the switch is off', async () => {
    await expect(
      make(false).importLegacy([legacy('c1')]),
    ).rejects.toMatchObject({
      response: { code: 'DATASET_BLOCKED' },
    });
    await expect(make(false).export('evaluation', 'x')).rejects.toMatchObject({
      response: { code: 'DATASET_BLOCKED' },
    });
    expect(prisma.ai_dataset_items.create).not.toHaveBeenCalled();
  });

  it('refuses without the DPIA and ethics review gates', async () => {
    prisma.ai_data_gates.findMany.mockResolvedValue([gate('dpia')]);
    await expect(make().importLegacy([legacy('c1')])).rejects.toMatchObject({
      missing: ['ethics_review'],
    });
  });

  it('imports only consented legacy chats, de-identified and encrypted', async () => {
    consents.state
      .mockResolvedValueOnce({ granted: true })
      .mockResolvedValueOnce({ granted: false });
    psikologs.allowsAny.mockResolvedValueOnce(true);
    const counts = await make().importLegacy([
      legacy('c1'),
      legacy('c2'),
      { conversation_id: 'bad' },
    ]);
    expect(counts).toEqual({
      imported: 1,
      invalid: 1,
      no_user_consent: 1,
      no_psikolog_consent: 0,
      already: 0,
    });
    const [[{ data }]] = prisma.ai_dataset_items.create.mock
      .calls as unknown as [
      [
        {
          data: {
            id: string;
            source: string;
            deid_findings: object;
            content_ciphertext: Uint8Array;
          };
        },
      ],
    ];
    expect(data).toMatchObject({
      source: 'legacy',
      deid_provider: 'local',
    });
    expect(data.deid_findings).toEqual({ PHONE_NUMBER: 1 });
    const stored = Buffer.from(data.content_ciphertext).toString();
    expect(stored.startsWith(`${data.id}|`)).toBe(true);
    expect(stored).not.toContain('081234567890');
  });

  it('skips legacy chats of a psikolog who allows no use', async () => {
    psikologs.allowsAny.mockResolvedValue(false);
    expect(
      (await make().importLegacy([legacy('c1')])).no_psikolog_consent,
    ).toBe(1);
  });

  const item = (
    id: string,
    source: 'teman_ai' | 'legacy',
    psychologist: string | null = 'PSY-1',
  ) => ({
    id,
    source,
    user_id: `u-${id}`,
    psychologist_id: psychologist,
    persona_id: source === 'teman_ai' ? 'p1' : null,
    used_for: [],
    content_ciphertext: sealed(
      id,
      JSON.stringify({
        turns: [{ role: 'user', text: '[PERSON_NAME] cemas' }],
      }),
    ),
  });

  it('exports for evaluation, withdrawing items whose user revoked consent', async () => {
    prisma.ai_dataset_items.findMany.mockResolvedValue([
      item('a', 'teman_ai'),
      item('b', 'teman_ai'),
      item('c', 'legacy'),
    ]);
    consents.trainingActive
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    psikologs.allows.mockResolvedValueOnce(false);
    const { manifest, items } = await make().export('evaluation', 'wildan');
    expect(items.map((i) => i.id)).toEqual(['a']);
    expect(JSON.stringify(items)).not.toContain('u-a');
    expect(manifest).toMatchObject({
      items: 1,
      skipped: { user_withdrawn: 1, psikolog_refused: 1 },
    });
    // Evaluation of a Teman AI conversation does not need the persona psikolog; legacy does.
    expect(psikologs.allows).toHaveBeenCalledTimes(1);
    expect(prisma.ai_dataset_items.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['b'] }, last_exported_at: null },
    });
    expect(prisma.ai_dataset_exports.create).toHaveBeenCalled();
    expect(prisma.ai_dataset_items.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'a' },
        data: expect.objectContaining({ used_for: ['evaluation'] }) as object,
      }),
    );
  });

  it('needs the persona psikolog for style examples', async () => {
    prisma.ai_dataset_items.findMany.mockResolvedValue([
      item('a', 'teman_ai', null),
    ]);
    const { items } = await make().export('style_examples', 'wildan');
    expect(items).toEqual([]);
  });

  it('fine-tuning needs its own gate and enough items', async () => {
    prisma.ai_dataset_items.findMany.mockResolvedValue([item('a', 'teman_ai')]);
    await expect(make().export('fine_tuning', 'x')).rejects.toMatchObject({
      missing: ['fine_tuning_go'],
    });
    prisma.ai_data_gates.findMany.mockResolvedValue([
      gate('dpia'),
      gate('ethics_review'),
      gate('fine_tuning_go'),
    ]);
    await expect(
      make(true, 2).export('fine_tuning', 'x'),
    ).rejects.toMatchObject({
      response: { code: 'DATASET_TOO_SMALL' },
    });
    expect(prisma.ai_dataset_exports.create).not.toHaveBeenCalled();
  });
});
