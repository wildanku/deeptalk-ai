import {
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { uuidv7 } from 'uuidv7';
import { ContentService } from '../content/content.service';
import { PrismaService } from '../database/prisma.service';
import { withdrawItems } from '../datasets/withdraw';
import type { ai_sessions, Prisma } from '../generated/prisma/client';
import {
  type ActiveConsentText,
  type ConsentDecision,
  consentState,
  type ConsentState,
  type ConsentType,
  TRAINING_OFFER_MIN_SESSIONS,
} from './consent-policy';

type Db = PrismaService | Prisma.TransactionClient;

export interface ConsentsView {
  service: ConsentState;
  ai_training: ConsentState;
  /** Phase 9; `text` is null (and the UI shows nothing) until a text exists. */
  legacy_counseling: ConsentState;
}

export interface TrainingOffer {
  type: 'ai_training';
  text: NonNullable<ConsentState['text']>;
}

/**
 * Versioned consents (02 §9.2). `service` is required before the first message except when the
 * beta trial bypass is enabled; `ai_training` is optional, offered after a calm session from
 * the third one on, and revocable. History is append-only (`ai_consents`): the newest row per
 * type is the current decision.
 */
@Injectable()
export class ConsentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly content: ContentService,
  ) {}

  async text(type: ConsentType): Promise<ActiveConsentText | null> {
    const active = await this.content.active('consent_text', type);
    if (!active || active.body.type !== type) return null;
    return {
      version: active.version,
      draft: active.status !== 'approved',
      body: active.body,
    };
  }

  async state(userId: string, type: ConsentType): Promise<ConsentState> {
    const [text, latest] = await Promise.all([
      this.text(type),
      this.latest(this.prisma, userId, type),
    ]);
    return consentState(type, text, latest);
  }

  async view(userId: string): Promise<ConsentsView> {
    const [service, training, legacy] = await Promise.all([
      this.state(userId, 'service'),
      this.state(userId, 'ai_training'),
      this.state(userId, 'legacy_counseling'),
    ]);
    return { service, ai_training: training, legacy_counseling: legacy };
  }

  /**
   * Records a decision. Agreeing is only valid for the text currently shown (`text_version`);
   * revoking always applies. Revoking `ai_training` also removes every earlier session from
   * any future training export — consent withdrawal looks back, not only forward.
   */
  async record(
    userId: string,
    type: ConsentType,
    textVersion: number,
    granted: boolean,
  ): Promise<ConsentState> {
    const text = await this.text(type);
    if (!text) {
      throw new ServiceUnavailableException({
        code: 'CONSENT_TEXT_UNAVAILABLE',
        message: 'Teks persetujuan belum tersedia',
      });
    }
    if (granted && textVersion !== text.version) {
      throw new ConflictException({
        code: 'CONSENT_TEXT_OUTDATED',
        message:
          'Teks persetujuan sudah diperbarui, muat ulang dan baca versi terbaru',
      });
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.ai_consents.create({
        data: {
          id: uuidv7(),
          user_id: userId,
          type,
          text_version: granted ? textVersion : text.version,
          granted,
        },
      });
      if (type === 'ai_training' && !granted) {
        await tx.ai_sessions.updateMany({
          where: { user_id: userId },
          data: { exclude_from_training: true },
        });
        await tx.ai_session_summaries.updateMany({
          where: { user_id: userId },
          data: { exclude_from_training: true },
        });
        await withdrawItems(tx, { user_id: userId, source: 'teman_ai' });
      }
      // Phase 9: earlier counseling chats leave the dataset as soon as consent is withdrawn.
      if (type === 'legacy_counseling' && !granted) {
        await withdrawItems(tx, { user_id: userId, source: 'legacy' });
      }
    });
    return this.state(userId, type);
  }

  /**
   * Whether a new session may be used for training (consent active right now). Uses the pool:
   * never call it inside an interactive transaction.
   */
  async trainingActive(userId: string): Promise<boolean> {
    const [text, latest] = await Promise.all([
      this.text('ai_training'),
      this.latest(this.prisma, userId, 'ai_training'),
    ]);
    return consentState('ai_training', text, latest).granted;
  }

  /**
   * The training consent offer for a session that just ended (02 §9.2): never after a session
   * that left `normal` (even if it recovered), never before the user's third session, and
   * never again once the user has answered the current text.
   */
  async trainingOffer(session: ai_sessions): Promise<TrainingOffer | null> {
    if (session.max_risk_level !== 'normal') return null;
    const [escalations, ended, state] = await Promise.all([
      this.prisma.ai_safety_events.count({
        where: {
          session_id: session.id,
          level: { in: ['elevated', 'crisis'] },
        },
      }),
      this.prisma.ai_sessions.count({
        where: { user_id: session.user_id, status: 'ended' },
      }),
      this.state(session.user_id, 'ai_training'),
    ]);
    if (escalations > 0 || ended < TRAINING_OFFER_MIN_SESSIONS) return null;
    if (!state.text || state.decided) return null;
    return { type: 'ai_training', text: state.text };
  }

  private async latest(
    db: Db,
    userId: string,
    type: ConsentType,
  ): Promise<ConsentDecision | null> {
    return db.ai_consents.findFirst({
      where: { user_id: userId, type },
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      select: { text_version: true, granted: true, created_at: true },
    });
  }
}
