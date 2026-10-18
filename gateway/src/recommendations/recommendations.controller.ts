import {
  Body,
  Controller,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { AiAuthGuard, AiRoles, CurrentPrincipal } from '../auth/ai-auth.guard';
import type { AiPrincipal } from '../auth/ai-principal';
import { RecommendationsService } from './recommendations.service';

class OpenedDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  psikolog_id: string;
}

@Controller('recommendations')
@UseGuards(AiAuthGuard)
@AiRoles('user')
export class RecommendationsController {
  constructor(private readonly recommendations: RecommendationsService) {}

  /** The client calls this when the user opens a recommended psikolog's profile from the card. */
  @Post(':id/opened')
  @HttpCode(204)
  async opened(
    @CurrentPrincipal() principal: AiPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: OpenedDto,
  ): Promise<void> {
    await this.recommendations.opened(principal.sub, id, body.psikolog_id);
  }
}
