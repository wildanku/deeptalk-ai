import { Module } from '@nestjs/common';
import { AssessmentsModule } from '../assessments/assessments.module';
import { ConsentsModule } from '../consents/consents.module';
import { MessagesModule } from '../messages/messages.module';
import { InstrumentsController } from './instruments.controller';
import { InstrumentsService } from './instruments.service';

/** Daily check-in, periodic screening, and personality inventory (03 Phase 8). */
@Module({
  imports: [ConsentsModule, MessagesModule, AssessmentsModule],
  controllers: [InstrumentsController],
  providers: [InstrumentsService],
})
export class InstrumentsModule {}
