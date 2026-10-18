import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../config/env.schema';
import { PrismaService } from '../database/prisma.service';
import { V3Client } from '../v3-client/v3-client.service';
import { ageInYears } from './age';

/**
 * `ok`, `missing` (no usable birth date in v3 — ask for it), `restricted` (below `AI_MIN_AGE`,
 * Q4), or `unverified` (v3 unreachable and no earlier check to fall back on).
 */
export type AgeStatus = 'ok' | 'missing' | 'restricted' | 'unverified';

export interface AgeCheck {
  status: AgeStatus;
  min_age: number;
}

/**
 * Age gate (02 §9.2, Q4). The birth date lives in v3 (`users.birth_date`, nullable); the client
 * asks for it and saves it through v3's own profile update, so v3 stays the single source.
 * Only the outcome (`adult`/`minor`) is kept here, as a fallback while v3 is unreachable.
 */
@Injectable()
export class AgeService {
  private readonly logger = new Logger(AgeService.name);
  private readonly minAge: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly v3: V3Client,
    config: ConfigService<Environment, true>,
  ) {
    this.minAge = config.get('AI_MIN_AGE', { infer: true });
  }

  async check(userId: string, now = new Date()): Promise<AgeCheck> {
    let birthDate: string | null;
    try {
      const profile = await this.v3.userProfile(userId);
      if (!profile) return { status: 'unverified', min_age: this.minAge };
      birthDate = profile.birth_date;
    } catch {
      return { status: await this.fallback(userId), min_age: this.minAge };
    }
    const age = ageInYears(birthDate, now);
    const status: AgeStatus =
      age === null ? 'missing' : age < this.minAge ? 'restricted' : 'ok';
    const band =
      status === 'ok' ? 'adult' : status === 'restricted' ? 'minor' : null;
    await this.prisma.ai_user_state
      .upsert({
        where: { user_id: userId },
        create: { user_id: userId, age_band: band, age_checked_at: now },
        update: { age_band: band, age_checked_at: now },
      })
      .catch(() => this.logger.warn('Could not store age check'));
    return { status, min_age: this.minAge };
  }

  private async fallback(userId: string): Promise<AgeStatus> {
    const state = await this.prisma.ai_user_state.findUnique({
      where: { user_id: userId },
      select: { age_band: true },
    });
    if (state?.age_band === 'adult') return 'ok';
    if (state?.age_band === 'minor') return 'restricted';
    return 'unverified';
  }
}
