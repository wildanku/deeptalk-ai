import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { IsBoolean, IsString, MaxLength, MinLength } from 'class-validator';
import { AiAuthGuard, AiRoles, CurrentPrincipal } from '../auth/ai-auth.guard';
import type { AiPrincipal } from '../auth/ai-principal';
import { HandoffsService } from './handoffs.service';

class LinkDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  booking_id: string;
}

class ConfirmDto {
  @IsBoolean()
  share: boolean;
}

@Controller('handoffs')
@UseGuards(AiAuthGuard)
@AiRoles('user')
export class HandoffsController {
  constructor(private readonly handoffs: HandoffsService) {}

  @Get(':id')
  view(
    @CurrentPrincipal() principal: AiPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.handoffs.view(principal.sub, id);
  }

  /** Called by the client right after the booking is created (02 §5.5 step 3). */
  @Post(':id/link')
  link(
    @CurrentPrincipal() principal: AiPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: LinkDto,
  ) {
    return this.handoffs.link(principal.sub, id, body.booking_id);
  }

  /** The user booked a different psikolog: share the summary with them or not. */
  @Post(':id/confirm')
  confirm(
    @CurrentPrincipal() principal: AiPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ConfirmDto,
  ) {
    return this.handoffs.confirm(principal.sub, id, body.share);
  }
}
