import { Global, Module } from '@nestjs/common';
import { AlertService } from './alert.service';
import { SafetyReviewController } from './safety-review.controller';
import { SafetyService } from './safety.service';

/**
 * L1 deterministic checks before the agent, protocols, `ai_safety_events` audit, and
 * content-free alerts (02 §7.2). L2/L3 run in the agent.
 */
@Global()
@Module({
  controllers: [SafetyReviewController],
  providers: [SafetyService, AlertService],
  exports: [SafetyService],
})
export class SafetyModule {}
