import { Module } from '@nestjs/common';
import { AssessmentsService } from './assessments.service';
import { ReferralsController } from './referrals.controller';
import { ReferralsService } from './referrals.service';

/** Topic → assessment mapping, catalog tool (02 §5.3, §7.4), and referral tracking (Phase 7). */
@Module({
  controllers: [ReferralsController],
  providers: [AssessmentsService, ReferralsService],
  exports: [AssessmentsService, ReferralsService],
})
export class AssessmentsModule {}
