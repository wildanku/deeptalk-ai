import { Module } from '@nestjs/common';
import { AgentClientModule } from '../agent-client/agent-client.module';
import { ConsentsModule } from '../consents/consents.module';
import { MessagesModule } from '../messages/messages.module';
import { MemoryService } from './memory.service';
import { SessionTimersService } from './session-timers.service';
import { SessionsService } from './sessions.service';

/**
 * Session lifecycle, monthly quota, active time, idle/wall-clock/close timers as tasks (02 §6.3),
 * and cross-session memory (02 §6.5). REST endpoints live in `RealtimeModule`.
 */
@Module({
  imports: [MessagesModule, AgentClientModule, ConsentsModule],
  providers: [SessionsService, SessionTimersService, MemoryService],
  exports: [SessionsService, SessionTimersService, MemoryService],
})
export class SessionsModule {}
