import { NotFoundException } from '@nestjs/common';
import type { AgentClient } from '../agent-client/agent-client.service';
import type { PrismaService } from '../database/prisma.service';
import type { MessageCipher } from '../messages/crypto/message-cipher.service';
import type { OutboxService } from '../outbox/outbox.service';
import type { V3Client } from '../v3-client/v3-client.service';
import { HandoffsService, sanitizeDocument } from './handoffs.service';

const DOC = {
  sections: [{ id: 'keluhan', title: 'Keluhan', body: 'b' }],
  disclaimer: 'x',
};

describe('HandoffsService', () => {
  const prisma = {
    ai_handoff_psikologs: { findUnique: jest.fn() },
    ai_handoffs: {
      count: jest.fn(),
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
  };
  const v3 = { psikolog: jest.fn(), booking: jest.fn() };
  const agent = { handoffDraft: jest.fn() };
  const cipher = {
    encrypt: jest.fn(() => Promise.resolve(Buffer.from('c'))),
    decrypt: jest.fn(() => Promise.resolve(JSON.stringify(DOC))),
  };
  const service = new HandoffsService(
    prisma as unknown as PrismaService,
    v3 as unknown as V3Client,
    agent as unknown as AgentClient,
    cipher as unknown as MessageCipher,
    {} as OutboxService,
  );

  beforeEach(() => jest.clearAllMocks());

  describe('propose', () => {
    const base = {
      userId: 'u1',
      sessionId: 's1',
      history: [],
      routines: [],
      assessments: [],
      risk: 'normal' as const,
    };

    it('rejects a psikolog who does not accept handoffs (fake or inactive ID)', async () => {
      prisma.ai_handoff_psikologs.findUnique.mockResolvedValue(null);

      await expect(
        service.propose({
          ...base,
          input: { psikolog_id: 'fake', reason: 'r' },
        }),
      ).resolves.toBeNull();
      expect(agent.handoffDraft).not.toHaveBeenCalled();
    });

    it('rejects a psikolog whose public profile is gone', async () => {
      prisma.ai_handoff_psikologs.findUnique.mockResolvedValue({
        active: true,
      });
      v3.psikolog.mockResolvedValue(null);

      await expect(
        service.propose({ ...base, input: { psikolog_id: 'p1', reason: 'r' } }),
      ).resolves.toBeNull();
    });

    it('drafts and stores an encrypted summary for a valid psikolog', async () => {
      prisma.ai_handoff_psikologs.findUnique.mockResolvedValue({
        active: true,
      });
      v3.psikolog.mockResolvedValue({
        id: 'p1',
        name: 'Bu A',
        avatar: null,
        specialists: ['Kecemasan'],
      });
      prisma.ai_handoffs.count.mockResolvedValue(0);
      agent.handoffDraft.mockResolvedValue({
        sections: [
          { id: 'keluhan', title: 'Keluhan utama', body: 'Sulit tidur' },
          { id: 'diagnosis', title: 'Diagnosis', body: 'tidak boleh ada' },
        ],
        disclaimer: 'apa saja',
        model: 'm',
        prompt_version: 'p',
      });

      const card = await service.propose({
        ...base,
        input: { psikolog_id: 'p1', reason: 'r' },
      });

      expect(card?.draft_sections.map((s) => s.id)).toEqual(['keluhan']);
      expect(card?.disclaimer).toBe(
        'Observasi dari percakapan dengan AI, bukan diagnosis.',
      );
      const created = prisma.ai_handoffs.create.mock.calls[0] as [
        { data: { draft_ciphertext: unknown } },
      ];
      expect(created[0].data.draft_ciphertext).toBeInstanceOf(Uint8Array);
    });
  });

  describe('readForPsikolog', () => {
    const linked = {
      id: 'h1',
      user_id: 'u1',
      psychologist_id: 'p1',
      booked_psychologist_id: null,
      status: 'linked',
      final_ciphertext: Buffer.from('c'),
      viewed_at: null,
      approved_at: new Date(),
    };

    it('refuses a psikolog who is not assigned to the handoff', async () => {
      prisma.ai_handoffs.findFirst.mockResolvedValue(linked);

      await expect(
        service.readForPsikolog('b1', 'p-other'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(cipher.decrypt).not.toHaveBeenCalled();
    });

    it('refuses when the booking no longer belongs to that psikolog', async () => {
      prisma.ai_handoffs.findFirst.mockResolvedValue(linked);
      v3.booking.mockResolvedValue({
        user_id: 'u1',
        psikolog_id: 'p-new',
        status: 'paid',
      });

      await expect(service.readForPsikolog('b1', 'p1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(cipher.decrypt).not.toHaveBeenCalled();
    });

    it('serves the approved summary to the assigned psikolog and marks it viewed', async () => {
      prisma.ai_handoffs.findFirst.mockResolvedValue(linked);
      v3.booking.mockResolvedValue({
        user_id: 'u1',
        psikolog_id: 'p1',
        status: 'paid',
      });

      await expect(service.readForPsikolog('b1', 'p1')).resolves.toMatchObject({
        sections: DOC.sections,
      });
      const updated = prisma.ai_handoffs.update.mock.calls[0] as [
        { where: { id: string }; data: { status: string } },
      ];
      expect(updated[0].where).toEqual({ id: 'h1' });
      expect(updated[0].data.status).toBe('viewed');
    });

    it('follows a re-confirmed handoff to the psikolog actually booked', async () => {
      prisma.ai_handoffs.findFirst.mockResolvedValue({
        ...linked,
        booked_psychologist_id: 'p2',
      });
      v3.booking.mockResolvedValue({
        user_id: 'u1',
        psikolog_id: 'p2',
        status: 'paid',
      });

      await expect(service.readForPsikolog('b1', 'p1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(service.readForPsikolog('b1', 'p2')).resolves.toBeTruthy();
    });
  });

  describe('link', () => {
    it("treats someone else's booking as not found", async () => {
      prisma.ai_handoffs.findFirst.mockResolvedValue({
        id: 'h1',
        user_id: 'u1',
        psychologist_id: 'p1',
        status: 'approved',
      });
      v3.booking.mockResolvedValue({
        user_id: 'u-other',
        psikolog_id: 'p1',
        status: 'paid',
      });

      await expect(service.link('u1', 'h1', 'b1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('asks for confirmation when another psikolog was booked', async () => {
      prisma.ai_handoffs.findFirst.mockResolvedValue({
        id: 'h1',
        user_id: 'u1',
        psychologist_id: 'p1',
        status: 'approved',
      });
      v3.booking.mockResolvedValue({
        user_id: 'u1',
        psikolog_id: 'p2',
        status: 'paid',
      });

      await expect(service.link('u1', 'h1', 'b1')).resolves.toEqual({
        status: 'pending_confirmation',
        booked_psikolog_id: 'p2',
      });
    });
  });
});

describe('sanitizeDocument', () => {
  it('keeps known sections once each and fixes the disclaimer', () => {
    expect(
      sanitizeDocument([
        { id: 'keluhan', title: 'A', body: 'a' },
        { id: 'keluhan', title: 'B', body: 'b' },
        { id: 'unknown', title: 'C', body: 'c' },
        { id: 'pola', title: '', body: 'empty title' },
      ]),
    ).toEqual({
      sections: [{ id: 'keluhan', title: 'A', body: 'a' }],
      disclaimer: 'Observasi dari percakapan dengan AI, bukan diagnosis.',
    });
  });
});
