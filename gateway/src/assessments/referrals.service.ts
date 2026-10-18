import { Injectable } from '@nestjs/common';
import { uuidv7 } from 'uuidv7';
import { PrismaService } from '../database/prisma.service';
import type { AssessmentCard } from './assessments.service';

/**
 * Assessment referrals for the impact indicators (Konsep §8): which assessment cards were offered
 * and which the user opened. No content; the user's history and account deletion remove them.
 */
@Injectable()
export class ReferralsService {
  constructor(private readonly prisma: PrismaService) {}

  async offered(
    userId: string,
    sessionId: string,
    card: AssessmentCard,
  ): Promise<string> {
    const id = uuidv7();
    await this.prisma.ai_assessment_referrals.create({
      data: {
        id,
        user_id: userId,
        session_id: sessionId,
        assessment_id: card.assessment_id,
        topic: card.topic,
      },
    });
    return id;
  }

  /** Idempotent; only the user's own referral, only the first open counts. */
  async opened(userId: string, referralId: string): Promise<void> {
    await this.prisma.ai_assessment_referrals.updateMany({
      where: { id: referralId, user_id: userId, opened_at: null },
      data: { opened_at: new Date() },
    });
  }
}
