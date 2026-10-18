import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  IsBoolean,
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
import type { AiReportReason } from '../generated/prisma/client';
import { ReportsService } from './reports.service';

const REASONS: AiReportReason[] = [
  'harmful',
  'inaccurate',
  'inappropriate',
  'other',
];

class ReportDto {
  @IsIn(REASONS)
  reason: AiReportReason;

  /** Lets a reviewer read this one AI reply (never the user's own messages). */
  @IsBoolean()
  share_content: boolean;
}

class ListQuery {
  @IsOptional()
  @IsIn(['open', 'reviewed'])
  status?: 'open' | 'reviewed';

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

@Controller('messages')
@UseGuards(AiAuthGuard)
@AiRoles('user')
export class MessageReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Post(':id/report')
  report(
    @CurrentPrincipal() principal: AiPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ReportDto,
  ) {
    return this.reports.report(
      principal.sub,
      id,
      body.reason,
      body.share_content,
    );
  }
}

/** Reports in the dashboard's safety review (clinical reviewers). */
@Controller('review/reports')
@UseGuards(AiAuthGuard, StaffRoleGuard)
@AiRoles('psikolog')
@RequireStaffRole('clinical_reviewer')
export class ReportsReviewController {
  constructor(private readonly reports: ReportsService) {}

  @Get()
  list(@Query() query: ListQuery) {
    return this.reports.list(query.status ?? 'open', query.before);
  }

  @Patch(':id')
  review(
    @CurrentPrincipal() principal: AiPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ReviewDto,
  ) {
    return this.reports.review(id, principal.sub, body.review_notes);
  }
}
