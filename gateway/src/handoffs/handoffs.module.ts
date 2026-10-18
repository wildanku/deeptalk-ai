import { Module } from '@nestjs/common';
import { AgentClientModule } from '../agent-client/agent-client.module';
import { InternalTokenGuard } from '../auth/internal-token.guard';
import { MessagesModule } from '../messages/messages.module';
import { RoutinesModule } from '../routines/routines.module';
import { HandoffsController } from './handoffs.controller';
import { HandoffsService } from './handoffs.service';
import { InternalController } from './internal.controller';
import { PsikologHandoffsController } from './psikolog-handoffs.controller';

/** Handoff drafts, user approval, booking link verification, and psikolog access (02 §5.5). */
@Module({
  imports: [MessagesModule, AgentClientModule, RoutinesModule],
  controllers: [
    HandoffsController,
    InternalController,
    PsikologHandoffsController,
  ],
  providers: [HandoffsService, InternalTokenGuard],
  exports: [HandoffsService],
})
export class HandoffsModule {}
