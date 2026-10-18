import { Module } from '@nestjs/common';
import { AgeService } from './age.service';
import { ConsentsService } from './consents.service';
import { OnboardingService } from './onboarding.service';

/**
 * Versioned service and training consents and the age gate (02 §9.2). REST endpoints live in
 * `RealtimeModule` (`OnboardingController`), next to the session they may close.
 */
@Module({
  providers: [ConsentsService, AgeService, OnboardingService],
  exports: [ConsentsService, AgeService, OnboardingService],
})
export class ConsentsModule {}
