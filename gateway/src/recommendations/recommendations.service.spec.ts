import type { ContentService } from '../content/content.service';
import type { PrismaService } from '../database/prisma.service';
import type { MessageCipher } from '../messages/crypto/message-cipher.service';
import type { V3Client } from '../v3-client/v3-client.service';
import { RecommendationsService } from './recommendations.service';

describe('RecommendationsService', () => {
  const stored: Record<string, unknown>[] = [];
  const prisma = {
    ai_psikolog_recommendations: {
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        stored.push(data);
        return Promise.resolve(data);
      }),
      findMany: jest.fn(() =>
        Promise.resolve(
          stored.map((data) => ({
            ...data,
            offered_at: new Date('2026-10-16T08:00:00Z'),
            opened_psychologist_id: 'SPS1',
          })),
        ),
      ),
    },
  };
  // Reversible stand-in that also checks the AAD is the row ID.
  const cipher = {
    encrypt: jest.fn((plain: string, aad: string) =>
      Promise.resolve(Buffer.from(`${aad}|${plain}`)),
    ),
    decrypt: jest.fn((data: Uint8Array, aad: string) => {
      const text = Buffer.from(data).toString();
      if (!text.startsWith(`${aad}|`)) throw new Error('bad aad');
      return Promise.resolve(text.slice(aad.length + 1));
    }),
  };
  const v3 = {
    psikologDirectory: jest.fn().mockResolvedValue([
      {
        id: 'SPS1',
        name: 'Psikolog Satu',
        avatar: null,
        specialists: ['Karir'],
        year_experience: 4,
        gender: null,
        rating: { rate: 4.9, total: 12 },
        price_from: 50000,
      },
    ]),
  };
  const content = { activePersonas: jest.fn().mockResolvedValue([]) };
  const service = new RecommendationsService(
    prisma as unknown as PrismaService,
    v3 as unknown as V3Client,
    content as unknown as ContentService,
    cipher as unknown as MessageCipher,
  );

  it('stores the card encrypted and anchored to its reply, and reads it back as shown', async () => {
    const card = await service.offer({
      userId: 'u1',
      sessionId: 's1',
      messageId: 'm2',
      input: {
        reason: 'Cocok untuk stres kerja.',
        items: [{ psikolog_id: 'SPS1', reason: 'Spesialis karir.' }],
      },
    });

    expect(card).toMatchObject({
      message_id: 'm2',
      psikologs: [{ id: 'SPS1', reason: 'Spesialis karir.' }],
    });
    // The reasons never sit in a plain column.
    expect(stored[0]).toMatchObject({
      message_id: 'm2',
      psychologist_ids: ['SPS1'],
    });
    expect(JSON.stringify(Object.keys(stored[0]))).not.toContain('reason');
    expect(cipher.encrypt).toHaveBeenCalledWith(
      expect.any(String),
      card?.recommendation_id,
    );

    const [again] = await service.forSession('s1');
    expect(again).toMatchObject({ ...card, opened_psikolog_id: 'SPS1' });
  });
});
