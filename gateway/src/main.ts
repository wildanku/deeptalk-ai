// Must stay first: instrumentations patch http/undici before Nest loads them.
import './observability/tracing';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { buildCorsOptions } from './common/http/cors';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import type { Environment } from './config/env.schema';
import { PrismaService } from './database/prisma.service';
import { RedisIoAdapter } from './realtime/redis-io.adapter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  const config = app.get(ConfigService<Environment, true>);

  app.use(helmet());
  // One CORS policy for HTTP and Socket.IO (see RedisIoAdapter).
  app.enableCors(buildCorsOptions(config.get('CORS_ORIGINS', { infer: true })));
  app.enableShutdownHooks();

  // Socket.IO fan-out across gateway instances (02 A8).
  const redisIoAdapter = new RedisIoAdapter(app, app.get(ConfigService));
  await redisIoAdapter.connectToRedis();
  app.useWebSocketAdapter(redisIoAdapter);

  app.setGlobalPrefix('v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.get(PrismaService).enableShutdownHooks(app);

  await app.listen(config.get('PORT', { infer: true }), '0.0.0.0');
}

void bootstrap();
