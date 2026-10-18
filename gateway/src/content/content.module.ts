import { Global, Module } from '@nestjs/common';
import { ContentController } from './content.controller';
import { ContentService } from './content.service';
import { CoverageController, TopicsController } from './coverage.controller';
import { ReviewController } from './review.controller';
import { ReviewService } from './review.service';

/**
 * Versioned clinical content (Persona Card, protocols, L1 phrases, routine library, knowledge)
 * with psikolog approval. Only `approved` content is ever active in production (02 §8, A12).
 * Curation workflow for clinical reviewers (`/v1/review/content`, Phase 5).
 */
@Global()
@Module({
  controllers: [
    ContentController,
    ReviewController,
    TopicsController,
    CoverageController,
  ],
  providers: [ContentService, ReviewService],
  exports: [ContentService],
})
export class ContentModule {}
