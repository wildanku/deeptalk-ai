import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { uuidv7 } from 'uuidv7';
import { z } from 'zod';
import { AgentClient } from '../agent-client/agent-client.service';
import { PrismaService } from '../database/prisma.service';
import type { ai_handoffs } from '../generated/prisma/client';
import { MessageCipher } from '../messages/crypto/message-cipher.service';
import { OutboxService } from '../outbox/outbox.service';
import type { RiskLevel } from '../safety/risk';
import {
  V3Client,
  type V3Psikolog,
  type V3UserAssessment,
} from '../v3-client/v3-client.service';

/** Sections of the pre-session summary (02 §7.4, Konsep §3.5). */
export const HANDOFF_SECTION_IDS = [
  'keluhan',
  'pola',
  'routine',
  'asesmen',
  'risiko',
  'topik',
] as const;
export const HANDOFF_DISCLAIMER =
  'Observasi dari percakapan dengan AI, bukan diagnosis.';

export interface HandoffSection {
  id: (typeof HANDOFF_SECTION_IDS)[number];
  title: string;
  body: string;
}

interface HandoffDocument {
  sections: HandoffSection[];
  disclaimer: string;
}

export interface HandoffCard {
  handoff_id: string;
  psikolog: {
    id: string;
    name: string;
    avatar: string | null;
    specialists: string[];
  };
  reason: string;
  draft_sections: HandoffSection[];
  disclaimer: string;
}

export interface HandoffDeepLinks {
  web: string;
  app: string;
}

const proposalSchema = z.object({
  psikolog_id: z.string().min(1).max(255),
  reason: z.string().trim().min(1).max(300),
});

const sectionSchema = z.object({
  id: z.enum(HANDOFF_SECTION_IDS),
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(2000),
});

const decisionSchema = z.object({
  handoff_id: z.string().uuid(),
  decision: z.enum(['approve', 'decline']),
  removed_section_ids: z
    .array(z.enum(HANDOFF_SECTION_IDS))
    .max(HANDOFF_SECTION_IDS.length)
    .default([]),
});

/**
 * Handoff to a psikolog (Phase 3, 02 §5.5): a pre-session summary drafted by the agent (Pro
 * tier), approved section by section by the user, linked to the booking they make, and readable
 * only by the psikolog actually assigned to that booking. Summaries are encrypted at rest.
 */
@Injectable()
export class HandoffsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly v3: V3Client,
    private readonly agent: AgentClient,
    private readonly cipher: MessageCipher,
    private readonly outbox: OutboxService,
  ) {}

  /** Psikolog who accept handoffs and still have a public profile. */
  async directory(): Promise<V3Psikolog[]> {
    const active = await this.prisma.ai_handoff_psikologs.findMany({
      where: { active: true },
      take: 10,
    });
    const profiles = await Promise.all(
      active.map((row) =>
        this.v3.psikolog(row.psychologist_id).catch(() => null),
      ),
    );
    return profiles.filter(
      (profile): profile is V3Psikolog => profile !== null,
    );
  }

  /** Validates the agent's proposal, drafts the summary, and stores it encrypted. */
  async propose(params: {
    userId: string;
    sessionId: string;
    input: unknown;
    history: { role: 'user' | 'assistant'; content: string }[];
    routines: { title: string; adherence_7d: number }[];
    assessments: V3UserAssessment[];
    risk: RiskLevel;
  }): Promise<HandoffCard | null> {
    const parsed = proposalSchema.safeParse(params.input);
    if (!parsed.success) return null;
    const accepted = await this.prisma.ai_handoff_psikologs.findUnique({
      where: { psychologist_id: parsed.data.psikolog_id },
    });
    if (!accepted?.active) return null;
    const psikolog = await this.v3
      .psikolog(parsed.data.psikolog_id)
      .catch(() => null);
    if (!psikolog) return null;
    const pending = await this.prisma.ai_handoffs.count({
      where: { session_id: params.sessionId, status: 'draft' },
    });
    if (pending > 0) return null;

    const draft = await this.agent.handoffDraft({
      history: params.history,
      psikolog: {
        id: psikolog.id,
        name: psikolog.name,
        specialists: psikolog.specialists,
      },
      reason: parsed.data.reason,
      routines: params.routines,
      assessments: params.assessments,
      risk_level: params.risk,
    });
    const document = sanitizeDocument(draft.sections);
    if (document.sections.length === 0) return null;

    const id = uuidv7();
    await this.prisma.ai_handoffs.create({
      data: {
        id,
        session_id: params.sessionId,
        user_id: params.userId,
        psychologist_id: psikolog.id,
        reason: parsed.data.reason,
        draft_ciphertext: new Uint8Array(
          await this.cipher.encrypt(JSON.stringify(document), id),
        ),
      },
    });
    return {
      handoff_id: id,
      psikolog: {
        id: psikolog.id,
        name: psikolog.name,
        avatar: psikolog.avatar,
        specialists: psikolog.specialists,
      },
      reason: parsed.data.reason,
      draft_sections: document.sections,
      disclaimer: document.disclaimer,
    };
  }

  /** The user approves (minus removed sections) or declines. Nothing is shared before this. */
  async decide(
    userId: string,
    input: unknown,
  ): Promise<{
    status: 'approved' | 'declined';
    deep_links: HandoffDeepLinks | null;
  }> {
    const parsed = decisionSchema.safeParse(input);
    if (!parsed.success) throw new BadRequestException('Keputusan tidak valid');
    const handoff = await this.owned(userId, parsed.data.handoff_id);
    if (handoff.status !== 'draft')
      throw new ConflictException('Ringkasan sudah diputuskan');
    if (parsed.data.decision === 'decline') {
      await this.prisma.ai_handoffs.update({
        where: { id: handoff.id },
        data: { status: 'declined' },
      });
      return { status: 'declined', deep_links: null };
    }
    const draft = await this.document(handoff, 'draft');
    const removed = new Set(parsed.data.removed_section_ids);
    const final: HandoffDocument = {
      ...draft,
      sections: draft.sections.filter((section) => !removed.has(section.id)),
    };
    await this.prisma.ai_handoffs.update({
      where: { id: handoff.id },
      data: {
        status: 'approved',
        approved_at: new Date(),
        removed_section_ids: [...removed],
        final_ciphertext: new Uint8Array(
          await this.cipher.encrypt(JSON.stringify(final), handoff.id),
        ),
      },
    });
    return { status: 'approved', deep_links: deepLinks(handoff) };
  }

  /** For the client: the handoff's current state, e.g. to resume a booking flow. */
  async view(userId: string, handoffId: string) {
    const handoff = await this.owned(userId, handoffId);
    const document =
      handoff.status === 'draft'
        ? await this.document(handoff, 'draft')
        : handoff.final_ciphertext
          ? await this.document(handoff, 'final')
          : null;
    return {
      handoff_id: handoff.id,
      status: handoff.status,
      psikolog_id: handoff.psychologist_id,
      booking_id: handoff.booking_id,
      sections: document?.sections ?? [],
      disclaimer: document?.disclaimer ?? HANDOFF_DISCLAIMER,
      deep_links: handoff.status === 'approved' ? deepLinks(handoff) : null,
    };
  }

  /**
   * After booking (02 §5.5 step 3–5): verifies the booking with v3. Same psikolog → linked and
   * the psikolog is notified. A different psikolog → waits for the user to confirm sharing
   * with them.
   */
  async link(
    userId: string,
    handoffId: string,
    bookingId: string,
  ): Promise<{
    status: 'linked' | 'pending_confirmation';
    booked_psikolog_id: string;
  }> {
    const handoff = await this.owned(userId, handoffId);
    if (!['approved', 'pending_confirmation'].includes(handoff.status)) {
      throw new ConflictException(
        'Ringkasan belum disetujui atau sudah ditautkan',
      );
    }
    const booking = await this.v3.booking(bookingId);
    // Someone else's booking looks exactly like a missing one.
    if (!booking || booking.user_id !== userId)
      throw new NotFoundException('Booking tidak ditemukan');
    if (booking.psikolog_id === handoff.psychologist_id) {
      await this.markLinked(handoff, bookingId, null);
      return { status: 'linked', booked_psikolog_id: booking.psikolog_id };
    }
    await this.prisma.ai_handoffs.update({
      where: { id: handoff.id },
      data: {
        status: 'pending_confirmation',
        booking_id: bookingId,
        booked_psychologist_id: booking.psikolog_id,
      },
    });
    return {
      status: 'pending_confirmation',
      booked_psikolog_id: booking.psikolog_id,
    };
  }

  /** The user booked another psikolog: share with them only on explicit confirmation. */
  async confirm(
    userId: string,
    handoffId: string,
    share: boolean,
  ): Promise<{ status: 'linked' | 'declined' }> {
    const handoff = await this.owned(userId, handoffId);
    if (
      handoff.status !== 'pending_confirmation' ||
      !handoff.booking_id ||
      !handoff.booked_psychologist_id
    ) {
      throw new ConflictException('Tidak ada konfirmasi yang menunggu');
    }
    if (!share) {
      await this.prisma.ai_handoffs.update({
        where: { id: handoff.id },
        data: { status: 'declined' },
      });
      return { status: 'declined' };
    }
    await this.markLinked(
      handoff,
      handoff.booking_id,
      handoff.booked_psychologist_id,
    );
    return { status: 'linked' };
  }

  /**
   * Read by the psikolog via v3 (`GET /v2/psikolog/book/:id/ai-summary`). v3 has already
   * checked the booking belongs to this psikolog; this re-checks against the booking and the
   * handoff's effective psikolog, so an unassigned psikolog never sees a summary.
   */
  async readForPsikolog(bookingId: string, psikologId: string) {
    const handoff = await this.prisma.ai_handoffs.findFirst({
      where: { booking_id: bookingId, status: { in: ['linked', 'viewed'] } },
      orderBy: { linked_at: 'desc' },
    });
    const effective = handoff
      ? (handoff.booked_psychologist_id ?? handoff.psychologist_id)
      : null;
    if (!handoff || effective !== psikologId)
      throw new NotFoundException('Ringkasan tidak ditemukan');
    const booking = await this.v3.booking(bookingId);
    if (
      !booking ||
      booking.psikolog_id !== psikologId ||
      booking.user_id !== handoff.user_id
    ) {
      throw new NotFoundException('Ringkasan tidak ditemukan');
    }
    const document = await this.document(handoff, 'final');
    if (!handoff.viewed_at) {
      await this.prisma.ai_handoffs.update({
        where: { id: handoff.id },
        data: { status: 'viewed', viewed_at: new Date() },
      });
    }
    return {
      handoff_id: handoff.id,
      booking_id: bookingId,
      approved_at: handoff.approved_at?.toISOString() ?? null,
      sections: document.sections,
      disclaimer: document.disclaimer,
    };
  }

  /** Summaries shared with this psikolog (linked to one of their bookings), newest first. */
  async listForPsikolog(psikologId: string) {
    const rows = await this.prisma.ai_handoffs.findMany({
      where: {
        status: { in: ['linked', 'viewed'] },
        OR: [
          { booked_psychologist_id: psikologId },
          { booked_psychologist_id: null, psychologist_id: psikologId },
        ],
      },
      orderBy: { linked_at: 'desc' },
      take: 100,
    });
    return rows.map((row) => ({
      handoff_id: row.id,
      booking_id: row.booking_id,
      reason: row.reason,
      status: row.status,
      approved_at: row.approved_at?.toISOString() ?? null,
      linked_at: row.linked_at?.toISOString() ?? null,
      viewed_at: row.viewed_at?.toISOString() ?? null,
    }));
  }

  /** Detail in the dashboard: the same checks as the v3 route (assigned psikolog only). */
  async readByIdForPsikolog(handoffId: string, psikologId: string) {
    const handoff = await this.prisma.ai_handoffs.findUnique({
      where: { id: handoffId },
      select: { booking_id: true },
    });
    if (!handoff?.booking_id)
      throw new NotFoundException('Ringkasan tidak ditemukan');
    return this.readForPsikolog(handoff.booking_id, psikologId);
  }

  private async markLinked(
    handoff: ai_handoffs,
    bookingId: string,
    bookedPsikologId: string | null,
  ) {
    const psikologId = bookedPsikologId ?? handoff.psychologist_id;
    const outboxId = await this.prisma.$transaction(async (tx) => {
      await tx.ai_handoffs.update({
        where: { id: handoff.id },
        data: {
          status: 'linked',
          booking_id: bookingId,
          booked_psychologist_id: bookedPsikologId,
          linked_at: new Date(),
        },
      });
      return this.outbox.add(
        'notification',
        {
          notifications: [
            {
              notification_key: `ai-handoff:${handoff.id}`,
              audience: 'psikolog',
              recipient_id: psikologId,
              title: 'Ringkasan pra-sesi tersedia',
              body: 'Klien baru membagikan ringkasan dari DeepTalk AI untuk sesi yang akan datang.',
              data: { feature: 'teman_ai_handoff', booking_id: bookingId },
            },
          ],
        },
        tx,
      );
    });
    await this.outbox.dispatch(outboxId);
  }

  private async owned(userId: string, handoffId: string): Promise<ai_handoffs> {
    const handoff = await this.prisma.ai_handoffs.findFirst({
      where: { id: handoffId, user_id: userId },
    });
    if (!handoff) throw new NotFoundException('Ringkasan tidak ditemukan');
    return handoff;
  }

  private async document(
    handoff: ai_handoffs,
    which: 'draft' | 'final',
  ): Promise<HandoffDocument> {
    const ciphertext =
      which === 'draft' ? handoff.draft_ciphertext : handoff.final_ciphertext;
    if (!ciphertext) throw new NotFoundException('Ringkasan tidak ditemukan');
    return JSON.parse(
      await this.cipher.decrypt(ciphertext, handoff.id),
    ) as HandoffDocument;
  }
}

/** Keeps only known sections, once each, within length limits; disclaimer is fixed. */
export function sanitizeDocument(sections: unknown[]): HandoffDocument {
  const seen = new Set<string>();
  const clean: HandoffSection[] = [];
  for (const section of sections) {
    const parsed = sectionSchema.safeParse(section);
    if (!parsed.success || seen.has(parsed.data.id)) continue;
    seen.add(parsed.data.id);
    clean.push(parsed.data);
  }
  return { sections: clean, disclaimer: HANDOFF_DISCLAIMER };
}

function deepLinks(handoff: ai_handoffs): HandoffDeepLinks {
  const id = encodeURIComponent(handoff.psychologist_id);
  const param = `ai_handoff=${encodeURIComponent(handoff.id)}`;
  return {
    web: `/psychologists/${id}?${param}`,
    app: `counseling/psychologist/${id}?${param}`,
  };
}
