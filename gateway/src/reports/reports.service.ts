import { Injectable, NotFoundException } from '@nestjs/common';
import { uuidv7 } from 'uuidv7';
import { PrismaService } from '../database/prisma.service';
import type { AiReportReason, Prisma } from '../generated/prisma/client';
import { MessageCipher } from '../messages/crypto/message-cipher.service';
import { MetricsService } from '../observability/metrics.service';

const PAGE = 50;

/**
 * "Laporkan respons AI" (Phase 6): Google Play's AI-generated content policy requires users to
 * be able to flag AI output from inside the app. A report names the message, persona, and
 * reason — never the user, never free text. Reviewers read the reply itself only when the user
 * allowed it, and only while the message still exists (history or account deletion removes it).
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: MessageCipher,
    private readonly metrics: MetricsService,
  ) {}

  /** Idempotent per message: reporting again updates the reason and the sharing choice. */
  async report(
    userId: string,
    messageId: string,
    reason: AiReportReason,
    shareContent: boolean,
  ): Promise<{ reported: true }> {
    const message = await this.prisma.ai_messages.findFirst({
      where: { id: messageId, role: 'assistant', session: { user_id: userId } },
      select: {
        id: true,
        session_id: true,
        persona_version: true,
        session: { select: { persona_id: true } },
      },
    });
    if (!message) throw new NotFoundException('Pesan tidak ditemukan');
    await this.prisma.ai_message_reports.upsert({
      where: { message_id: message.id },
      create: {
        id: uuidv7(),
        message_id: message.id,
        session_id: message.session_id,
        persona_id: message.session.persona_id,
        persona_version: message.persona_version,
        reason,
        share_content: shareContent,
      },
      update: { reason, share_content: shareContent },
    });
    this.metrics.record('message_reported', { reason });
    return { reported: true };
  }

  async list(status: 'open' | 'reviewed', before?: string) {
    const where: Prisma.ai_message_reportsWhereInput = {
      reviewed_at: status === 'reviewed' ? { not: null } : null,
      ...(before ? { created_at: { lt: new Date(before) } } : {}),
    };
    const rows = await this.prisma.ai_message_reports.findMany({
      where,
      orderBy: { created_at: 'desc' },
      take: PAGE,
      include: {
        message: {
          select: {
            id: true,
            content_ciphertext: true,
            model: true,
            prompt_version: true,
          },
        },
      },
    });
    const items = await Promise.all(
      rows.map(async (row) => ({
        id: row.id,
        reason: row.reason,
        persona_id: row.persona_id,
        persona_version: row.persona_version,
        created_at: row.created_at.toISOString(),
        model: row.message?.model ?? null,
        prompt_version: row.message?.prompt_version ?? null,
        content_available: row.share_content && row.message !== null,
        ai_response:
          row.share_content && row.message
            ? await this.cipher.decrypt(
                row.message.content_ciphertext,
                row.message.id,
              )
            : null,
        reviewed_by: row.reviewed_by,
        reviewed_at: row.reviewed_at?.toISOString() ?? null,
        review_notes: row.review_notes,
      })),
    );
    return {
      items,
      next_before:
        rows.length === PAGE
          ? rows[rows.length - 1].created_at.toISOString()
          : null,
    };
  }

  async review(id: string, reviewerId: string, notes: string) {
    const { count } = await this.prisma.ai_message_reports.updateMany({
      where: { id },
      data: {
        reviewed_by: reviewerId,
        reviewed_at: new Date(),
        review_notes: notes,
      },
    });
    if (count === 0) throw new NotFoundException('Laporan tidak ditemukan');
    return { id, reviewed_by: reviewerId };
  }
}
