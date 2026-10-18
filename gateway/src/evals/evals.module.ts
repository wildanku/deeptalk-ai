import { Module } from '@nestjs/common';
import { AgentClientModule } from '../agent-client/agent-client.module';
import { EvalRunsService } from './eval-runs.service';
import { PersonaWorkspaceService } from './persona-workspace.service';
import { PsikologController } from './psikolog.controller';

/**
 * Persona curation by its psikolog (questionnaire, case studies, draft, corrections, approval,
 * disable) and evaluation runs with psikolog ratings (02 §10.2, §12.1).
 */
@Module({
  imports: [AgentClientModule],
  controllers: [PsikologController],
  providers: [PersonaWorkspaceService, EvalRunsService],
})
export class EvalsModule {}
