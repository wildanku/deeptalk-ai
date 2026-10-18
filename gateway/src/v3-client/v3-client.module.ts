import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../config/env.schema';
import { RedisService } from '../redis/redis.service';
import { V3Client } from './v3-client.service';

/**
 * HTTP client to deeptalk-api-v3: public directory/catalog (cached in Redis) and
 * `/v2/internal/ai/*` with `x-ai-service-token` (02 §5).
 */
@Global()
@Module({
  providers: [
    {
      provide: V3Client,
      inject: [ConfigService, RedisService],
      useFactory: (
        config: ConfigService<Environment, true>,
        redis: RedisService,
      ) => new V3Client(config, redis),
    },
  ],
  exports: [V3Client],
})
export class V3ClientModule {}
