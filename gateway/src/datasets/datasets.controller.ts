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
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { AiAuthGuard, AiRoles, CurrentPrincipal } from '../auth/ai-auth.guard';
import type { AiPrincipal } from '../auth/ai-principal';
import { RequireStaffRole, StaffRoleGuard } from '../auth/staff-role.guard';
import type { AiDatasetItemStatus } from '../generated/prisma/client';
import { DatasetsService } from './datasets.service';
import { PsikologDataConsentService } from './psikolog-data-consent.service';

class ListQuery {
  @IsOptional()
  @IsIn(['pending_review', 'approved', 'rejected', 'withdrawn'])
  status?: AiDatasetItemStatus;

  @IsOptional()
  @IsISO8601()
  before?: string;
}

class ReviewDto {
  @IsIn(['approved', 'rejected'])
  decision: 'approved' | 'rejected';

  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  review_notes: string;
}

class AddendumDto {
  @IsInt()
  @Min(1)
  text_version: number;

  @IsBoolean()
  allow_evaluation: boolean;

  @IsBoolean()
  allow_style_examples: boolean;

  @IsBoolean()
  allow_training: boolean;
}

/**
 * Manual review of de-identified dataset items (Konsep §7.4 step 3). A separate role from the
 * clinical reviewer: reading conversation text, even de-identified, is a different permission.
 */
@Controller('review/dataset')
@UseGuards(AiAuthGuard, StaffRoleGuard)
@AiRoles('psikolog')
@RequireStaffRole('data_reviewer')
export class DatasetReviewController {
  constructor(private readonly datasets: DatasetsService) {}

  /** Gates, switch, and counts — what the dashboard shows before any item. */
  @Get('summary')
  summary() {
    return this.datasets.summary();
  }

  @Get()
  list(@Query() query: ListQuery) {
    return this.datasets.list(query.status ?? 'pending_review', query.before);
  }

  @Get(':id')
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.datasets.detail(id);
  }

  @Patch(':id')
  review(
    @CurrentPrincipal() principal: AiPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ReviewDto,
  ) {
    return this.datasets.review(
      id,
      principal.sub,
      body.decision,
      body.review_notes,
    );
  }
}

/** The psikolog addendum: agree to the text and choose which uses of their responses to allow. */
@Controller('psikolog/data-consent')
@UseGuards(AiAuthGuard)
@AiRoles('psikolog')
export class PsikologDataConsentController {
  constructor(private readonly consents: PsikologDataConsentService) {}

  @Get()
  view(@CurrentPrincipal() principal: AiPrincipal) {
    return this.consents.view(principal.sub);
  }

  @Post()
  record(
    @CurrentPrincipal() principal: AiPrincipal,
    @Body() body: AddendumDto,
  ) {
    return this.consents.record(principal.sub, body.text_version, {
      allow_evaluation: body.allow_evaluation,
      allow_style_examples: body.allow_style_examples,
      allow_training: body.allow_training,
    });
  }
}
