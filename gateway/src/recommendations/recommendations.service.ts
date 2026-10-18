import { Injectable } from '@nestjs/common';
import { uuidv7 } from 'uuidv7';
import { ContentService } from '../content/content.service';
import { PrismaService } from '../database/prisma.service';
import { MessageCipher } from '../messages/crypto/message-cipher.service';
import { V3Client } from '../v3-client/v3-client.service';
import {
  rankCandidates,
  type RecommendationCandidate,
  validateProposal,
} from './recommendation-rules';

/** `card.recommendation` payload (02 §6.2). */
export interface RecommendationCard {
  recommendation_id: string;
  /** The assistant reply the card is shown under; null for cards from before anchors existed. */
  message_id: string | null;
  reason: string;
  psikologs: (Omit<RecommendationCandidate, 'persona'> & {
    reason: string;
    /** "DeepTalk AI dengan pendekatan …" when the psikolog has an active persona. */
    persona_label: string | null;
  })[];
}

/**
 * Psikolog recommendations: every bookable psikolog in the v3 directory, with their approved
 * persona as extra signal. Unlike handoff, recommending needs no opt-in from the psikolog — it
 * only points the user to a public profile; nothing about the user is shared.
 */
@Injectable()
export class RecommendationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly v3: V3Client,
    private readonly content: ContentService,
    private readonly cipher: MessageCipher,
  ) {}

  async candidates(topics: string[]): Promise<RecommendationCandidate[]> {
    const [directory, personas] = await Promise.all([
      this.v3.psikologDirectory(),
      this.content.activePersonas(),
    ]);
    return rankCandidates(directory, personas, topics);
  }

  /**
   * Validates the agent's proposal against the directory and records the offer. Any directory
   * psikolog is accepted, not only this turn's shortlist: the card is public information.
   */
  async offer(params: {
    userId: string;
    sessionId: string;
    input: unknown;
    messageId?: string | null;
  }): Promise<RecommendationCard | null> {
    const [directory, personas] = await Promise.all([
      this.v3.psikologDirectory(),
      this.content.activePersonas(),
    ]);
    const all = rankCandidates(directory, personas, [], directory.length);
    const proposal = validateProposal(params.input, all);
    if (!proposal) return null;

    const id = uuidv7();
    const card: RecommendationCard = {
      recommendation_id: id,
      message_id: params.messageId ?? null,
      reason: proposal.reason,
      psikologs: proposal.items.map(({ candidate, reason }) => {
        const { persona, ...profile } = candidate;
        return {
          ...profile,
          reason,
          persona_label: persona
            ? `DeepTalk AI dengan pendekatan ${persona.label}`
            : null,
        };
      }),
    };
    await this.prisma.ai_psikolog_recommendations.create({
      data: {
        id,
        user_id: params.userId,
        session_id: params.sessionId,
        message_id: card.message_id,
        psychologist_ids: proposal.items.map((item) => item.candidate.id),
        // The reasons describe the user's story: stored like messages (02 §9.1).
        card_ciphertext: new Uint8Array(
          await this.cipher.encrypt(JSON.stringify(card), id),
        ),
      },
    });
    return card;
  }

  /** The session's cards as shown, for reconnects and the read-only transcript. */
  async forSession(sessionId: string): Promise<
    (RecommendationCard & {
      opened_psikolog_id: string | null;
      created_at: Date;
    })[]
  > {
    const rows = await this.prisma.ai_psikolog_recommendations.findMany({
      where: { session_id: sessionId, card_ciphertext: { not: null } },
      orderBy: { offered_at: 'asc' },
    });
    return Promise.all(
      rows.map(async (row) => ({
        ...(JSON.parse(
          await this.cipher.decrypt(row.card_ciphertext as Uint8Array, row.id),
        ) as RecommendationCard),
        opened_psikolog_id: row.opened_psychologist_id,
        created_at: row.offered_at,
      })),
    );
  }

  /** Idempotent; only the user's own card, only the first open counts. */
  async opened(
    userId: string,
    recommendationId: string,
    psikologId: string,
  ): Promise<void> {
    await this.prisma.ai_psikolog_recommendations.updateMany({
      where: {
        id: recommendationId,
        user_id: userId,
        opened_at: null,
        psychologist_ids: { has: psikologId },
      },
      data: { opened_at: new Date(), opened_psychologist_id: psikologId },
    });
  }
}
