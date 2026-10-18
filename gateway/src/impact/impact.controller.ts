import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { AiAuthGuard, AiRoles } from '../auth/ai-auth.guard';
import { RequireStaffRole, StaffRoleGuard } from '../auth/staff-role.guard';
import { ImpactService } from './impact.service';

class ImpactQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  days?: number;
}

/** Impact indicators (Konsep §8) for the dashboard; aggregates only. */
@Controller('review/impact')
@UseGuards(AiAuthGuard, StaffRoleGuard)
@AiRoles('psikolog')
@RequireStaffRole('clinical_reviewer')
export class ImpactController {
  constructor(private readonly impact: ImpactService) {}

  @Get()
  report(@Query() query: ImpactQuery) {
    return this.impact.report(query.days ?? 30);
  }
}
