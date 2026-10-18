import {
  Controller,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AiAuthGuard, AiRoles, CurrentPrincipal } from '../auth/ai-auth.guard';
import type { AiPrincipal } from '../auth/ai-principal';
import { ReferralsService } from './referrals.service';

@Controller('assessments/referrals')
@UseGuards(AiAuthGuard)
@AiRoles('user')
export class ReferralsController {
  constructor(private readonly referrals: ReferralsService) {}

  /** The client calls this when the user opens the assessment from the card. */
  @Post(':id/opened')
  @HttpCode(204)
  async opened(
    @CurrentPrincipal() principal: AiPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.referrals.opened(principal.sub, id);
  }
}
