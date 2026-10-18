import { Module } from '@nestjs/common';
import { AgentClientModule } from '../agent-client/agent-client.module';
import { AssessmentsModule } from '../assessments/assessments.module';
import { ConsentsModule } from '../consents/consents.module';
import { OnboardingController } from '../consents/onboarding.controller';
import { RecommendationsModule } from '../recommendations/recommendations.module';
import { HandoffsModule } from '../handoffs/handoffs.module';
import { MessagesModule } from '../messages/messages.module';
import { RoutinesModule } from '../routines/routines.module';
import { SessionsController } from '../sessions/sessions.controller';
import { SessionsModule } from '../sessions/sessions.module';
import { AiGateway } from './ai.gateway';
import { ConversationService } from './conversation.service';
import { PersonaUsageService } from './persona-pool';
import { SessionStateService } from './session-state.service';
import { TurnService } from './turn.service';

/** Socket.IO `/ai` and the conversation turn — the module that ties the features together. */
@Module({
  imports: [
    SessionsModule,
    MessagesModule,
    AgentClientModule,
    RoutinesModule,
    AssessmentsModule,
    HandoffsModule,
    RecommendationsModule,
    ConsentsModule,
  ],
  controllers: [SessionsController, OnboardingController],
  providers: [
    AiGateway,
    TurnService,
    ConversationService,
    SessionStateService,
    PersonaUsageService,
  ],
})
export class RealtimeModule {}
