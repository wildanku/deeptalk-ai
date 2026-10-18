import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ConfigService } from '@nestjs/config';
import type { AssessmentsService } from '../assessments/assessments.service';
import type { Environment } from '../config/env.schema';
import type { OnboardingService } from '../consents/onboarding.service';
import { instrumentSchema } from '../content/content.schemas';
import type { ContentService } from '../content/content.service';
import type { PrismaService } from '../database/prisma.service';
import type { MessageCipher } from '../messages/crypto/message-cipher.service';
import type { MetricsService } from '../observability/metrics.service';
import type { SafetyService } from '../safety/safety.service';
import { InstrumentsService } from './instruments.service';

const body = instrumentSchema.parse({
  purpose: 'screening',
  title: 'Skrining uji',
  intro: 'Pengantar',
  disclaimer: 'Bukan diagnosis',
  interval_days: 14,
  options: [0, 1, 2, 3].map((value) => ({ value, label: `opsi ${value}` })),
  items: [
    { id: 'a', prompt: 'A' },
    { id: 'b', prompt: 'B', safety: { min_value: 1, level: 'crisis' } },
  ],
  scoring: {
    method: 'sum',
    bands: [
      {
        min: 3,
        max: 6,
        label: 'Tinggi',
        description: 't',
        suggest: 'assessment',
      },
    ],
  },
  topic: 'kecemasan',
});

// 2026-10-14 10:00 in Jakarta.
const NOW = new Date('2026-10-14T03:00:00Z');
const TZ = 'Asia/Jakarta';

describe('InstrumentsService', () => {
  const prisma = {
    ai_instrument_responses: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      upsert: jest.fn(),
      deleteMany: jest.fn(),
      groupBy: jest.fn(),
    },
  };
  const content = {
    active: jest.fn(),
    listActive: jest.fn(),
  };
  const cipher = {
    encrypt: jest.fn((text: string, aad: string) =>
      Promise.resolve(Buffer.from(`${aad}|${text}`)),
    ),
    decrypt: jest.fn((data: Uint8Array, aad: string) =>
      Promise.resolve(
        Buffer.from(data)
          .toString()
          .slice(aad.length + 1),
      ),
    ),
  };
  const safety = {
    protocol: jest.fn(() =>
      Promise.resolve({
        level: 'crisis',
        title: 'P',
        message: 'm',
        contacts: [],
        version: 'fallback',
      }),
    ),
    record: jest.fn(),
  };
  const onboarding = { gate: jest.fn() };
  const assessments = {
    catalogFor: jest.fn(() =>
      Promise.resolve([{ id: 'as1', title: 'Asesmen', topic: 'kecemasan' }]),
    ),
  };
  const metrics = { record: jest.fn() };
  const config = {
    get: (key: string) =>
      key === 'DEFAULT_TIMEZONE' ? 'Asia/Jakarta' : 'https://help',
  };
  const service = new InstrumentsService(
    prisma as unknown as PrismaService,
    content as unknown as ContentService,
    cipher as unknown as MessageCipher,
    safety as unknown as SafetyService,
    onboarding as unknown as OnboardingService,
    assessments as unknown as AssessmentsService,
    metrics as unknown as MetricsService,
    config as unknown as ConfigService<Environment, true>,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    content.active.mockResolvedValue({
      refId: 'skr',
      version: 2,
      status: 'draft',
      body,
    });
    onboarding.gate.mockResolvedValue(null);
    prisma.ai_instrument_responses.findFirst.mockResolvedValue(null);
    prisma.ai_instrument_responses.findUnique.mockResolvedValue(null);
  });

  it('keeps the sample personality inventory bilingual and explicitly unvalidated', async () => {
    const source = JSON.parse(
      readFileSync(
        resolve(
          __dirname,
          '../../../content/instruments/inventori-kepribadian.json',
        ),
        'utf8',
      ),
    ) as { body: unknown; status: string };
    const inventory = instrumentSchema.parse(source.body);

    expect(source.status).toBe('DRAFT');
    expect(inventory.items).toHaveLength(6);
    expect(inventory.translations?.en.items).toHaveLength(6);
    expect(JSON.stringify(inventory)).not.toContain('[DRAFT]');
    expect(inventory.disclaimer).toContain(
      'belum ditinjau atau divalidasi psikolog',
    );
    expect(inventory.translations?.en.disclaimer).toContain(
      'not been reviewed or validated',
    );

    content.active.mockResolvedValue({
      refId: 'inventori-kepribadian',
      version: 3,
      status: 'draft',
      body: inventory,
    });
    const submitted = await service.submit(
      'u1',
      'inventori-kepribadian',
      {
        answers: Object.fromEntries(
          inventory.items.map((item) => [item.id, 4]),
        ),
        timezone: TZ,
        locale: 'en',
      },
      NOW,
    );
    expect(submitted.result).toMatchObject({
      disclaimer: inventory.translations?.en.disclaimer,
      dimensions: [
        { id: 'adaptasi', label: 'Adapting to change' },
        { id: 'interaksi', label: 'Interacting with others' },
      ],
    });
  });

  const submit = (answers: Record<string, number>) =>
    service.submit('u1', 'skr', { answers, timezone: TZ }, NOW);

  it('refuses before age and consent gates pass', async () => {
    onboarding.gate.mockResolvedValue({
      code: 'CONSENT_REQUIRED',
      message: 'm',
    });
    await expect(submit({ a: 0, b: 0 })).rejects.toMatchObject({ status: 403 });
    expect(prisma.ai_instrument_responses.upsert).not.toHaveBeenCalled();
  });

  it('returns translated content when the requested locale is English', async () => {
    const itemOptions = [
      { value: 0, label: 'Tidak' },
      { value: 1, label: 'Ya' },
    ];
    const translatedBody = instrumentSchema.parse({
      ...body,
      items: body.items.map((item) =>
        item.id === 'a' ? { ...item, options: itemOptions } : item,
      ),
      translations: {
        en: {
          title: 'Sample inventory',
          intro: 'Sample introduction',
          disclaimer: 'Sample disclaimer',
          options: body.options.map((option) => ({
            ...option,
            label: `English ${option.value}`,
          })),
          items: body.items.map((item) => ({
            id: item.id,
            prompt: `English ${item.id}`,
            ...(item.id === 'a'
              ? {
                  options: [
                    { value: 0, label: 'No' },
                    { value: 1, label: 'Yes' },
                  ],
                }
              : {}),
          })),
          scoring: { dimensions: [], bands: [] },
        },
      },
    });
    content.active.mockResolvedValue({
      refId: 'skr',
      version: 3,
      status: 'draft',
      body: translatedBody,
    });

    const detail = await service.detail('u1', 'skr', TZ, NOW, 'en');
    expect(detail).toMatchObject({
      title: 'Sample inventory',
      intro: 'Sample introduction',
      disclaimer: 'Sample disclaimer',
    });
    expect(detail.items[0]).toMatchObject({ id: 'a', prompt: 'English a' });
    expect(detail.items[0].options).toEqual([
      { value: 0, label: 'No' },
      { value: 1, label: 'Yes' },
    ]);
  });

  it('stores answers and result only as ciphertext bound to the row', async () => {
    const result = await submit({ a: 3, b: 0 });
    const [[call]] = prisma.ai_instrument_responses.upsert.mock.calls as [
      [{ create: Record<string, unknown> }],
    ];
    expect(call.create).toMatchObject({
      user_id: 'u1',
      instrument_ref: 'skr',
      instrument_version: 2,
      purpose: 'screening',
      safety_level: 'normal',
    });
    expect(Object.keys(call.create)).not.toContain('answers');
    expect(cipher.encrypt).toHaveBeenCalledWith(expect.any(String), result.id);
    expect(result).toMatchObject({
      local_date: '2026-10-14',
      next_due: '2026-10-28',
      protocol: null,
      result: {
        total: { score: 3 },
        band: { label: 'Tinggi', suggest: 'assessment' },
      },
      assessments: [{ id: 'as1' }],
    });
    expect(safety.record).not.toHaveBeenCalled();
  });

  it('returns the crisis protocol and records a content-free safety event', async () => {
    const result = await submit({ a: 0, b: 1 });
    expect(result.protocol).toMatchObject({
      level: 'crisis',
      help_url: 'https://help',
    });
    expect(safety.record).toHaveBeenCalledWith({
      sessionId: null,
      layer: 'instrument',
      level: 'crisis',
      signals: ['instrument:skr'],
    });
    expect(metrics.record).toHaveBeenCalledWith('crisis_protocol_sent', {
      path: 'instrument',
    });
  });

  it('refuses a new entry before the interval has passed', async () => {
    prisma.ai_instrument_responses.findFirst.mockResolvedValue({
      local_date: new Date('2026-10-10T00:00:00Z'),
    });
    await expect(submit({ a: 0, b: 0 })).rejects.toMatchObject({
      response: { code: 'INSTRUMENT_NOT_DUE' },
    });
  });

  it('replaces the same day instead of adding a second entry', async () => {
    prisma.ai_instrument_responses.findFirst.mockResolvedValue({
      local_date: new Date('2026-10-14T00:00:00Z'),
    });
    prisma.ai_instrument_responses.findUnique.mockResolvedValue({
      id: 'existing',
    });
    const result = await submit({ a: 1, b: 0 });
    expect(result.id).toBe('existing');
    expect(prisma.ai_instrument_responses.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'existing' } }),
    );
  });

  it('rejects invalid answers with a code', async () => {
    await expect(submit({ a: 9, b: 0 })).rejects.toMatchObject({
      response: { code: 'ANSWERS_INVALID_VALUE' },
    });
  });

  it('decrypts history for the owner only', async () => {
    const stored = JSON.stringify({
      answers: { a: 1, b: 0 },
      result: {
        total: { score: 1, min: 0, max: 6 },
        band: null,
        dimensions: [],
        safety_level: 'normal',
      },
    });
    prisma.ai_instrument_responses.findMany.mockResolvedValue([
      {
        id: 'r1',
        local_date: new Date('2026-10-13T00:00:00Z'),
        instrument_version: 2,
        result_ciphertext: Buffer.from(`r1|${stored}`),
      },
    ]);
    const history = await service.history('u1', 'skr', 7, TZ, NOW);
    expect(prisma.ai_instrument_responses.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          user_id: 'u1',
          instrument_ref: 'skr',
        }) as unknown,
      }),
    );
    expect(history.from).toBe('2026-10-08');
    expect(history.points).toEqual([
      expect.objectContaining({
        local_date: '2026-10-13',
        answers: { a: 1, b: 0 },
      }),
    ]);
  });

  it('skips a row that does not decrypt instead of failing the trend', async () => {
    prisma.ai_instrument_responses.findMany.mockResolvedValue([
      {
        id: 'bad',
        local_date: new Date('2026-10-13T00:00:00Z'),
        instrument_version: 2,
        result_ciphertext: Buffer.from('bad|not json'),
      },
    ]);
    const history = await service.history('u1', 'skr', 7, TZ, NOW);
    expect(history.points).toEqual([]);
  });

  it('lists instruments with their due state', async () => {
    content.listActive.mockResolvedValue([
      { refId: 'skr', version: 2, status: 'draft', body },
      {
        refId: 'cek',
        version: 1,
        status: 'approved',
        body: { ...body, purpose: 'checkin', interval_days: 1 },
      },
    ]);
    prisma.ai_instrument_responses.groupBy.mockResolvedValue([
      {
        instrument_ref: 'skr',
        _max: { local_date: new Date('2026-10-10T00:00:00Z') },
      },
      {
        instrument_ref: 'cek',
        _max: { local_date: new Date('2026-10-13T00:00:00Z') },
      },
    ]);
    const items = await service.list('u1', TZ, NOW);
    expect(items.map((i) => i.answered_today)).toEqual([false, false]);
    expect(
      items.map((i) => [i.ref, i.purpose, i.due, i.next_due, i.draft]),
    ).toEqual([
      ['cek', 'checkin', true, '2026-10-14', false],
      ['skr', 'screening', false, '2026-10-24', true],
    ]);
  });

  it('falls back to DEFAULT_TIMEZONE when the client sends none', async () => {
    content.listActive.mockResolvedValue([]);
    await expect(service.list('u1', undefined, NOW)).resolves.toEqual([]);
  });

  it('rejects an unknown time zone', async () => {
    await expect(service.list('u1', 'Mars/Base', NOW)).rejects.toMatchObject({
      status: 400,
    });
  });
});
