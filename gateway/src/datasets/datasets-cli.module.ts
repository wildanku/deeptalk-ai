import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DrainModule } from '../common/drain/drain.module';
import { validateEnvironment } from '../config/env.schema';
import { ConsentsService } from '../consents/consents.service';
import { ContentService } from '../content/content.service';
import { DatabaseModule } from '../database/database.module';
import { MessagesModule } from '../messages/messages.module';
import { DatasetsService } from './datasets.service';
import { deidentifierProvider } from './deid.provider';
import { PsikologDataConsentService } from './psikolog-data-consent.service';

/**
 * Just what `scripts/dataset.ts` needs: config, database, message keys, content, consents. No
 * HTTP, sockets, Redis, or queues, so a batch job never joins the serving fleet.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnvironment }),
    DrainModule,
    DatabaseModule,
    MessagesModule,
  ],
  providers: [
    ContentService,
    ConsentsService,
    PsikologDataConsentService,
    deidentifierProvider,
    DatasetsService,
  ],
})
export class DatasetsCliModule {}
