import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { AiAuthGuard, AiRoles, CurrentPrincipal } from '../auth/ai-auth.guard';
import type { AiPrincipal } from '../auth/ai-principal';
import { RoutinesService } from './routines.service';

class RoutineLogDto {
  @IsString()
  @MaxLength(128)
  item_id: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date: string;

  @IsBoolean()
  done: boolean;

  @IsOptional()
  @IsInt()
  value?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string | null;
}

class RoutineUpdateDto {
  @IsOptional()
  @IsIn(['active', 'paused', 'stopped'])
  status?: 'active' | 'paused' | 'stopped';

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  reminder_times?: string[];
}

class HistoryQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(60)
  days?: number;
}

/** Rutinitas screen (Phase 3). Never consumes the chat quota. */
@Controller('routines')
@UseGuards(AiAuthGuard)
@AiRoles('user')
export class RoutinesController {
  constructor(private readonly routines: RoutinesService) {}

  @Get()
  list(@CurrentPrincipal() principal: AiPrincipal) {
    return this.routines.listForUser(principal.sub);
  }

  @Post(':id/logs')
  @HttpCode(204)
  async log(
    @CurrentPrincipal() principal: AiPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: RoutineLogDto,
  ): Promise<void> {
    await this.routines.log(principal.sub, id, body);
  }

  @Get(':id/history')
  history(
    @CurrentPrincipal() principal: AiPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: HistoryQueryDto,
  ) {
    return this.routines.history(principal.sub, id, query.days);
  }

  @Get(':id/summary')
  summary(
    @CurrentPrincipal() principal: AiPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.routines.summary(principal.sub, id);
  }

  @Patch(':id')
  @HttpCode(204)
  async update(
    @CurrentPrincipal() principal: AiPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: RoutineUpdateDto,
  ): Promise<void> {
    await this.routines.update(principal.sub, id, body);
  }
}
