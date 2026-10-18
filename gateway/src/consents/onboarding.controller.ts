import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { IsBoolean, IsIn, IsInt, Min } from 'class-validator';
import { AiAuthGuard, AiRoles, CurrentPrincipal } from '../auth/ai-auth.guard';
import type { AiPrincipal } from '../auth/ai-principal';
import { SessionStateService } from '../realtime/session-state.service';
import { SessionsService } from '../sessions/sessions.service';
import type { ConsentType } from './consent-policy';
import { ConsentsService } from './consents.service';
import { OnboardingService } from './onboarding.service';

class ConsentDecisionDto {
  @IsIn(['service', 'ai_training', 'legacy_counseling'])
  type: ConsentType;

  @IsInt()
  @Min(1)
  text_version: number;

  @IsBoolean()
  granted: boolean;
}

/** Age gate and consents for the "Persetujuan & data" screen (02 §9.2, §10.1). */
@Controller('me')
@UseGuards(AiAuthGuard)
@AiRoles('user')
export class OnboardingController {
  constructor(
    private readonly onboarding: OnboardingService,
    private readonly consents: ConsentsService,
    private readonly sessions: SessionsService,
    private readonly state: SessionStateService,
  ) {}

  /** Everything the client checks before showing the chat input. */
  @Get('onboarding')
  view(@CurrentPrincipal() principal: AiPrincipal) {
    return this.onboarding.view(principal.sub);
  }

  @Get('consents')
  list(@CurrentPrincipal() principal: AiPrincipal) {
    return this.consents.view(principal.sub);
  }

  /** Revoking `service` ends the running session; access remains subject to the configured gate. */
  @Post('consents')
  async decide(
    @CurrentPrincipal() principal: AiPrincipal,
    @Body() body: ConsentDecisionDto,
  ) {
    const state = await this.consents.record(
      principal.sub,
      body.type,
      body.text_version,
      body.granted,
    );
    if (body.type === 'service' && !body.granted) {
      const active = await this.sessions.findActive(principal.sub);
      if (active) await this.sessions.close(active.id, 'completed');
      await this.state.clearPending(principal.sub);
    }
    return state;
  }
}
