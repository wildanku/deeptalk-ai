import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { RateLimitInterceptor } from './common/interceptors/rate-limit.interceptor';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { AgentClientModule } from './agent-client/agent-client.module';
import { AssessmentsModule } from './assessments/assessments.module';
import { AuthModule } from './auth/auth.module';
import { type Environment, validateEnvironment } from './config/env.schema';
import { ConsentsModule } from './consents/consents.module';
import { ContentModule } from './content/content.module';
import { DrainModule } from './common/drain/drain.module';
import { EmitterModule } from './common/emitter/emitter.module';
import { DatabaseModule } from './database/database.module';
import { DatasetsModule } from './datasets/datasets.module';
import { EvalsModule } from './evals/evals.module';
import { HandoffsModule } from './handoffs/handoffs.module';
import { HealthModule } from './health/health.module';
import { ImpactModule } from './impact/impact.module';
import { InstrumentsModule } from './instruments/instruments.module';
import { LifecycleModule } from './lifecycle/lifecycle.module';
import { MessagesModule } from './messages/messages.module';
import { OutboxModule } from './outbox/outbox.module';
import { buildLoggerParams } from './observability/logger';
import { ObservabilityModule } from './observability/observability.module';
import { RealtimeModule } from './realtime/realtime.module';
import { RedisModule } from './redis/redis.module';
import { ReportsModule } from './reports/reports.module';
import { RoutinesModule } from './routines/routines.module';
import { SafetyModule } from './safety/safety.module';
import { SessionsModule } from './sessions/sessions.module';
import { TasksModule } from './tasks/tasks.module';
import { V3ClientModule } from './v3-client/v3-client.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnvironment }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Environment, true>) =>
        buildLoggerParams({
          LOG_LEVEL: config.get('LOG_LEVEL', { infer: true }),
          NODE_ENV: config.get('NODE_ENV', { infer: true }),
        }),
    }),
    DrainModule,
    EmitterModule,
    ObservabilityModule,
    DatabaseModule,
    RedisModule,
    TasksModule,
    OutboxModule,
    HealthModule,
    RealtimeModule,
    AuthModule,
    V3ClientModule,
    AgentClientModule,
    SessionsModule,
    MessagesModule,
    SafetyModule,
    RoutinesModule,
    AssessmentsModule,
    HandoffsModule,
    ConsentsModule,
    LifecycleModule,
    ContentModule,
    EvalsModule,
    ReportsModule,
    ImpactModule,
    InstrumentsModule,
    DatasetsModule,
  ],
  providers: [{ provide: APP_INTERCEPTOR, useClass: RateLimitInterceptor }],
})
export class AppModule {}
