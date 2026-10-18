import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { AiAuthGuard, AiRoles, CurrentPrincipal } from '../auth/ai-auth.guard';
import type { AiPrincipal } from '../auth/ai-principal';
import { RequireStaffRole, StaffRoleGuard } from '../auth/staff-role.guard';
import { PrismaService } from '../database/prisma.service';
import type { Prisma } from '../generated/prisma/client';

const PAGE = 50;

class ListQuery {
  @IsOptional()
  @IsIn(['open', 'reviewed'])
  status?: 'open' | 'reviewed';

  @IsOptional()
  @IsIn(['elevated', 'crisis'])
  level?: 'elevated' | 'crisis';

  /** Cursor: events created before this time. */
  @IsOptional()
  @IsISO8601()
  before?: string;
}

class ReviewDto {
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  review_notes: string;
}

/**
 * Safety review (03 Phase 5, 02 §10.2): content-free events — layer, level, signal IDs, the
 * persona and session time. Never the user's identity or messages: opening a conversation
 * needs the user's permission under the policy still to be decided (Q5).
 */
@Controller('review/safety-events')
@UseGuards(AiAuthGuard, StaffRoleGuard)
@AiRoles('psikolog')
@RequireStaffRole('clinical_reviewer')
export class SafetyReviewController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(@Query() query: ListQuery) {
    const where: Prisma.ai_safety_eventsWhereInput = {
      level: query.level ?? { in: ['elevated', 'crisis'] },
      reviewed_at:
        query.status === 'reviewed'
          ? { not: null }
          : query.status === 'open'
            ? null
            : undefined,
      ...(query.before ? { created_at: { lt: new Date(query.before) } } : {}),
    };
    const rows = await this.prisma.ai_safety_events.findMany({
      where,
      orderBy: { created_at: 'desc' },
      take: PAGE,
      include: {
        session: {
          select: {
            persona_id: true,
            persona_version: true,
            max_risk_level: true,
            started_at: true,
          },
        },
      },
    });
    return {
      items: rows.map((row) => ({
        id: row.id,
        layer: row.layer,
        level: row.level,
        signals: row.signals,
        created_at: row.created_at.toISOString(),
        session: row.session
          ? {
              persona_id: row.session.persona_id,
              persona_version: row.session.persona_version,
              max_risk_level: row.session.max_risk_level,
              started_at: row.session.started_at.toISOString(),
            }
          : null,
        reviewed_by: row.reviewed_by,
        reviewed_at: row.reviewed_at?.toISOString() ?? null,
        review_notes: row.review_notes,
      })),
      next_before:
        rows.length === PAGE
          ? rows[rows.length - 1].created_at.toISOString()
          : null,
    };
  }

  @Patch(':id')
  async review(
    @CurrentPrincipal() principal: AiPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ReviewDto,
  ) {
    const { count } = await this.prisma.ai_safety_events.updateMany({
      where: { id },
      data: {
        reviewed_by: principal.sub,
        reviewed_at: new Date(),
        review_notes: body.review_notes,
      },
    });
    if (count === 0) throw new NotFoundException('Kejadian tidak ditemukan');
    return { id, reviewed_by: principal.sub };
  }
}
