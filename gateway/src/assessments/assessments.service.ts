import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { ContentService } from '../content/content.service';
import {
  V3Client,
  type V3UserAssessment,
} from '../v3-client/v3-client.service';

export interface AssessmentCard {
  assessment_id: string;
  title: string;
  reason: string;
  is_free: boolean;
  topic: string;
}

const proposalSchema = z.object({
  assessment_id: z.string().min(1).max(255),
  topic: z.string().regex(/^[a-z0-9_]{2,64}$/),
  reason: z.string().trim().min(1).max(300),
});

/**
 * Assessment recommendations (Phase 3): the catalog tool is v3's public catalog ∩ the
 * psikolog-approved topic mappings. The AI explains results but never computes a score
 * (Konsep §3.5).
 */
@Injectable()
export class AssessmentsService {
  private readonly logger = new Logger(AssessmentsService.name);

  constructor(
    private readonly content: ContentService,
    private readonly v3: V3Client,
  ) {}

  /** Approved `assessment_mapping` content (draft only where allowed), per topic. */
  private async mapped(topics: string[]): Promise<Map<string, string[]>> {
    const mappings = await this.content.listActive('assessment_mapping');
    return new Map(
      mappings
        .filter((mapping) => topics.includes(mapping.body.topic))
        .map((mapping) => [
          mapping.body.topic,
          mapping.body.assessment_product_ids,
        ]),
    );
  }

  async catalogFor(
    topics: string[],
  ): Promise<{ id: string; title: string; topic: string }[]> {
    if (topics.length === 0) return [];
    const pairs = [...(await this.mapped(topics))]
      .flatMap(([topic, ids]) => ids.map((id) => ({ topic, id })))
      .slice(0, 10);
    const items = await Promise.all(
      pairs.map(async ({ topic, id }) => {
        const product = await this.v3.assessment(id).catch(() => null);
        return product ? { id: product.id, title: product.name, topic } : null;
      }),
    );
    return items
      .filter(
        (item): item is { id: string; title: string; topic: string } =>
          item !== null,
      )
      .slice(0, 5);
  }

  /** Valid only for an approved mapping of that topic and a product still in the v3 catalog. */
  async validate(input: unknown): Promise<AssessmentCard | null> {
    const parsed = proposalSchema.safeParse(input);
    if (!parsed.success) return null;
    const mapped = (await this.mapped([parsed.data.topic])).get(
      parsed.data.topic,
    );
    if (!mapped?.includes(parsed.data.assessment_id)) return null;
    const product = await this.v3
      .assessment(parsed.data.assessment_id)
      .catch(() => null);
    if (!product) return null;
    return {
      assessment_id: product.id,
      title: product.name,
      reason: parsed.data.reason,
      is_free: product.is_free,
      topic: parsed.data.topic,
    };
  }

  /** Completed assessments for context; empty when v3 is unavailable (never blocks a turn). */
  async forUser(userId: string): Promise<V3UserAssessment[]> {
    try {
      return (await this.v3.userAssessments(userId)).slice(0, 5);
    } catch {
      this.logger.warn({ v3: 'user_assessments_unavailable' });
      return [];
    }
  }
}
