import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../config/env.schema';
import { AgentClient } from './agent-client.service';

/** SSE client for the private agent service, authenticated with a Cloud Run ID token (02 §7.1). */
@Module({
  providers: [
    {
      provide: AgentClient,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Environment, true>) =>
        new AgentClient(config),
    },
  ],
  exports: [AgentClient],
})
export class AgentClientModule {}
