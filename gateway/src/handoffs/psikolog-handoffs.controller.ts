import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { AiAuthGuard, AiRoles, CurrentPrincipal } from '../auth/ai-auth.guard';
import type { AiPrincipal } from '../auth/ai-principal';
import { HandoffsService } from './handoffs.service';

/** Pre-session summaries for the psikolog dashboard (02 §10.2). Opening one marks it viewed. */
@Controller('psikolog/handoffs')
@UseGuards(AiAuthGuard)
@AiRoles('psikolog')
export class PsikologHandoffsController {
  constructor(private readonly handoffs: HandoffsService) {}

  @Get()
  list(@CurrentPrincipal() principal: AiPrincipal) {
    return this.handoffs.listForPsikolog(principal.sub);
  }

  @Get(':id')
  detail(
    @CurrentPrincipal() principal: AiPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.handoffs.readByIdForPsikolog(id, principal.sub);
  }
}
