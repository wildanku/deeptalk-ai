import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import {
  IsBoolean,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { AiAuthGuard, AiRoles, CurrentPrincipal } from '../auth/ai-auth.guard';
import type { AiPrincipal } from '../auth/ai-principal';
import { StaffRolesService } from '../auth/staff-roles.service';
import { EvalRunsService } from './eval-runs.service';
import { PersonaWorkspaceService } from './persona-workspace.service';

class QuestionnaireDto {
  @IsObject()
  answers: Record<string, string>;
}

class CaseAnswerDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  response: string;
}

class CorrectionDto {
  @IsObject()
  card: Record<string, unknown>;
}

class RatingDto {
  @IsBoolean()
  safe: boolean;

  @IsBoolean()
  on_style: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

/** The psikolog's own AI workspace in the dashboard (03 Phase 5). */
@Controller('psikolog')
@UseGuards(AiAuthGuard)
@AiRoles('psikolog')
export class PsikologController {
  constructor(
    private readonly roles: StaffRolesService,
    private readonly workspace: PersonaWorkspaceService,
    private readonly runs: EvalRunsService,
  ) {}

  @Get('me')
  async me(@CurrentPrincipal() principal: AiPrincipal) {
    return {
      psikolog_id: principal.sub,
      roles: await this.roles.roles(principal.sub),
    };
  }

  @Get('persona')
  persona(@CurrentPrincipal() principal: AiPrincipal) {
    return this.workspace.view(principal.sub);
  }

  /** Dashboard home card: curation stage, without creating a workspace. */
  @Get('persona/status')
  personaStatus(@CurrentPrincipal() principal: AiPrincipal) {
    return this.workspace.status(principal.sub);
  }

  @Put('persona/questionnaire')
  questionnaire(
    @CurrentPrincipal() principal: AiPrincipal,
    @Body() body: QuestionnaireDto,
  ) {
    return this.workspace.saveQuestionnaire(principal.sub, body.answers);
  }

  @Put('persona/cases/:caseRef')
  caseAnswer(
    @CurrentPrincipal() principal: AiPrincipal,
    @Param('caseRef') caseRef: string,
    @Body() body: CaseAnswerDto,
  ) {
    return this.workspace.saveCase(principal.sub, caseRef, body.response);
  }

  @Post('persona/draft')
  draft(@CurrentPrincipal() principal: AiPrincipal) {
    return this.workspace.draft(principal.sub);
  }

  @Post('persona/versions')
  correct(
    @CurrentPrincipal() principal: AiPrincipal,
    @Body() body: CorrectionDto,
  ) {
    return this.workspace.correct(principal.sub, body.card);
  }

  @Post('persona/versions/:version/eval-runs')
  async startRun(
    @CurrentPrincipal() principal: AiPrincipal,
    @Param('version', ParseIntPipe) version: number,
  ) {
    const ws = await this.workspace.workspace(principal.sub);
    const run = await this.runs.start(ws.persona_id, version, principal.sub);
    return { id: run.id, status: run.status };
  }

  @Get('persona/eval-runs/:runId')
  async run(
    @CurrentPrincipal() principal: AiPrincipal,
    @Param('runId', ParseUUIDPipe) runId: string,
  ) {
    const ws = await this.workspace.workspace(principal.sub);
    return this.runs.view(ws.persona_id, runId);
  }

  @Put('persona/eval-runs/:runId/ratings/:ratingId')
  async rate(
    @CurrentPrincipal() principal: AiPrincipal,
    @Param('runId', ParseUUIDPipe) runId: string,
    @Param('ratingId', ParseUUIDPipe) ratingId: string,
    @Body() body: RatingDto,
  ) {
    const ws = await this.workspace.workspace(principal.sub);
    return this.runs.rate(ws.persona_id, runId, ratingId, principal.sub, body);
  }

  @Post('persona/versions/:version/approve')
  approve(
    @CurrentPrincipal() principal: AiPrincipal,
    @Param('version', ParseIntPipe) version: number,
  ) {
    return this.workspace.approve(principal.sub, version);
  }

  @Post('persona/disable')
  disable(@CurrentPrincipal() principal: AiPrincipal) {
    return this.workspace.setEnabled(principal.sub, false);
  }

  @Post('persona/enable')
  enable(@CurrentPrincipal() principal: AiPrincipal) {
    return this.workspace.setEnabled(principal.sub, true);
  }
}
