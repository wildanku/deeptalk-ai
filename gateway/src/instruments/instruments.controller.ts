import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { AiAuthGuard, AiRoles, CurrentPrincipal } from '../auth/ai-auth.guard';
import type { AiPrincipal } from '../auth/ai-principal';
import { InstrumentsService } from './instruments.service';

const REF = /^[a-z0-9][a-z0-9_-]{1,127}$/;

class ZoneQuery {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  tz?: string;

  @IsOptional()
  @IsIn(['id', 'en'])
  locale?: 'id' | 'en';
}

class HistoryQuery extends ZoneQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  days?: number;
}

class SubmitDto {
  /** `{ item_id: option value }`; validated against the instrument version by the service. */
  @IsObject()
  answers: Record<string, number>;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;

  @IsOptional()
  @IsIn(['id', 'en'])
  locale?: 'id' | 'en';
}

class RefParam {
  @Matches(REF)
  ref: string;
}

/** Check-in, screening, and personality inventory (03 Phase 8). Never consumes the chat quota. */
@Controller('instruments')
@UseGuards(AiAuthGuard)
@AiRoles('user')
export class InstrumentsController {
  constructor(private readonly instruments: InstrumentsService) {}

  @Get()
  async list(
    @CurrentPrincipal() principal: AiPrincipal,
    @Query() query: ZoneQuery,
  ) {
    return {
      items: await this.instruments.list(
        principal.sub,
        query.tz,
        undefined,
        query.locale,
      ),
    };
  }

  @Get(':ref')
  detail(
    @CurrentPrincipal() principal: AiPrincipal,
    @Param() params: RefParam,
    @Query() query: ZoneQuery,
  ) {
    return this.instruments.detail(
      principal.sub,
      params.ref,
      query.tz,
      undefined,
      query.locale,
    );
  }

  @Post(':ref/responses')
  submit(
    @CurrentPrincipal() principal: AiPrincipal,
    @Param() params: RefParam,
    @Body() body: SubmitDto,
  ) {
    return this.instruments.submit(principal.sub, params.ref, {
      answers: body.answers,
      timezone: body.timezone,
      locale: body.locale,
    });
  }

  @Get(':ref/responses')
  history(
    @CurrentPrincipal() principal: AiPrincipal,
    @Param() params: RefParam,
    @Query() query: HistoryQuery,
  ) {
    return this.instruments.history(
      principal.sub,
      params.ref,
      query.days ?? 30,
      query.tz,
      undefined,
      query.locale,
    );
  }

  @Delete('responses')
  async removeAll(@CurrentPrincipal() principal: AiPrincipal) {
    return { deleted: await this.instruments.removeAll(principal.sub) };
  }

  @Delete('responses/:id')
  @HttpCode(204)
  async remove(
    @CurrentPrincipal() principal: AiPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.instruments.remove(principal.sub, id);
  }
}
