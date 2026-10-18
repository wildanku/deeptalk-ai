import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { IsObject, IsString, MaxLength, MinLength } from 'class-validator';
import { AiAuthGuard, AiRoles, CurrentPrincipal } from '../auth/ai-auth.guard';
import type { AiPrincipal } from '../auth/ai-principal';
import { RequireStaffRole, StaffRoleGuard } from '../auth/staff-role.guard';
import { ReviewService } from './review.service';

class NewVersionDto {
  @IsObject()
  body: Record<string, unknown>;
}

class RejectDto {
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  notes: string;
}

/** Clinical content curation in the psikolog dashboard (03 Phase 5). */
@Controller('review/content')
@UseGuards(AiAuthGuard, StaffRoleGuard)
@AiRoles('psikolog')
@RequireStaffRole('clinical_reviewer')
export class ReviewController {
  constructor(private readonly review: ReviewService) {}

  @Get()
  overview() {
    return this.review.overview();
  }

  @Get(':kind/:refId')
  versions(@Param('kind') kind: string, @Param('refId') refId: string) {
    return this.review.versions(kind, refId);
  }

  @Post(':kind/:refId/versions')
  create(
    @CurrentPrincipal() principal: AiPrincipal,
    @Param('kind') kind: string,
    @Param('refId') refId: string,
    @Body() dto: NewVersionDto,
  ) {
    return this.review.create(kind, refId, dto.body, principal.sub);
  }

  @Post(':kind/:refId/versions/:version/submit')
  submit(
    @CurrentPrincipal() principal: AiPrincipal,
    @Param('kind') kind: string,
    @Param('refId') refId: string,
    @Param('version', ParseIntPipe) version: number,
  ) {
    return this.review.submit(kind, refId, version, principal.sub);
  }

  @Post(':kind/:refId/versions/:version/approve')
  approve(
    @CurrentPrincipal() principal: AiPrincipal,
    @Param('kind') kind: string,
    @Param('refId') refId: string,
    @Param('version', ParseIntPipe) version: number,
  ) {
    return this.review.approve(kind, refId, version, principal.sub);
  }

  @Post(':kind/:refId/versions/:version/reject')
  reject(
    @CurrentPrincipal() principal: AiPrincipal,
    @Param('kind') kind: string,
    @Param('refId') refId: string,
    @Param('version', ParseIntPipe) version: number,
    @Body() dto: RejectDto,
  ) {
    return this.review.reject(kind, refId, version, principal.sub, dto.notes);
  }
}
