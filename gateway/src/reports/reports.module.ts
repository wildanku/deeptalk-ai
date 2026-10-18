import { Module } from '@nestjs/common';
import { MessagesModule } from '../messages/messages.module';
import {
  MessageReportsController,
  ReportsReviewController,
} from './reports.controller';
import { ReportsService } from './reports.service';

/** User reports of AI replies and their review (Phase 6, app store AI-content policy). */
@Module({
  imports: [MessagesModule],
  controllers: [MessageReportsController, ReportsReviewController],
  providers: [ReportsService],
})
export class ReportsModule {}
