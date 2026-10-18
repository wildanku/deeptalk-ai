import {
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { uuidv7 } from 'uuidv7';
import { ContentService } from '../content/content.service';
import { PrismaService } from '../database/prisma.service';
import type { AiDatasetPurpose } from '../generated/prisma/client';

export interface PsikologAllows {
  allow_evaluation: boolean;
  allow_style_examples: boolean;
  allow_training: boolean;
}

const FIELD: Record<AiDatasetPurpose, keyof PsikologAllows> = {
  evaluation: 'allow_evaluation',
  style_examples: 'allow_style_examples',
  fine_tuning: 'allow_training',
};

/**
 * Psikolog addendum (Konsep §7.4 step 2): agreement to a versioned text, with the right to
 * refuse each use of their responses. Without a current agreement, nothing of theirs is used.
 */
@Injectable()
export class PsikologDataConsentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly content: ContentService,
  ) {}

  async view(psychologistId: string) {
    const [text, latest] = await Promise.all([
      this.text(),
      this.latest(psychologistId),
    ]);
    const current =
      !!text &&
      !!latest &&
      latest.text_version >= text.body.min_accepted_version;
    return {
      text: text
        ? {
            version: text.version,
            title: text.body.title,
            summary: text.body.summary,
            body: text.body.body,
            draft: text.status !== 'approved',
          }
        : null,
      /** Answered the current text; otherwise every use counts as refused. */
      current,
      allows: {
        allow_evaluation: current && !!latest?.allow_evaluation,
        allow_style_examples: current && !!latest?.allow_style_examples,
        allow_training: current && !!latest?.allow_training,
      } satisfies PsikologAllows,
      decided_at: latest?.created_at.toISOString() ?? null,
    };
  }

  async record(
    psychologistId: string,
    textVersion: number,
    allows: PsikologAllows,
  ) {
    const text = await this.text();
    if (!text) {
      throw new ServiceUnavailableException({
        code: 'CONSENT_TEXT_UNAVAILABLE',
        message: 'Teks addendum belum tersedia',
      });
    }
    if (textVersion !== text.version) {
      throw new ConflictException({
        code: 'CONSENT_TEXT_OUTDATED',
        message:
          'Teks addendum sudah diperbarui, muat ulang dan baca versi terbaru',
      });
    }
    await this.prisma.ai_psikolog_data_consents.create({
      data: {
        id: uuidv7(),
        psychologist_id: psychologistId,
        text_version: textVersion,
        ...allows,
      },
    });
    return this.view(psychologistId);
  }

  /** Whether this psikolog's responses may be used for `purpose` right now. */
  async allows(
    psychologistId: string,
    purpose: AiDatasetPurpose,
  ): Promise<boolean> {
    return (await this.view(psychologistId)).allows[FIELD[purpose]];
  }

  /** Allows at least one use (required before their counseling chats are imported). */
  async allowsAny(psychologistId: string): Promise<boolean> {
    const { allows } = await this.view(psychologistId);
    return Object.values(allows).some(Boolean);
  }

  private async text() {
    const active = await this.content.active(
      'consent_text',
      'psikolog_addendum',
    );
    return active && active.body.type === 'psikolog_addendum' ? active : null;
  }

  private latest(psychologistId: string) {
    return this.prisma.ai_psikolog_data_consents.findFirst({
      where: { psychologist_id: psychologistId },
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
    });
  }
}
