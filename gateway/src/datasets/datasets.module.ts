import { Module } from '@nestjs/common';
import { ConsentsModule } from '../consents/consents.module';
import { MessagesModule } from '../messages/messages.module';
import {
  DatasetReviewController,
  PsikologDataConsentController,
} from './datasets.controller';
import { DatasetsService } from './datasets.service';
import { deidentifierProvider } from './deid.provider';
import { PsikologDataConsentService } from './psikolog-data-consent.service';

/**
 * Data & model (03 Phase 9): psikolog addendum, de-identified dataset items, manual review,
 * staged export. Jobs run from `scripts/dataset.ts`; nothing runs without the approval gates.
 */
@Module({
  imports: [ConsentsModule, MessagesModule],
  controllers: [DatasetReviewController, PsikologDataConsentController],
  providers: [
    deidentifierProvider,
    DatasetsService,
    PsikologDataConsentService,
  ],
  exports: [DatasetsService],
})
export class DatasetsModule {}
