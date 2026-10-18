import {
  CallHandler,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Observable } from 'rxjs';
import type { AiRequest } from '../../auth/ai-auth.guard';
import type { Environment } from '../../config/env.schema';
import { RedisService } from '../../redis/redis.service';

/**
 * Per-principal REST rate limit (02 §9.1; Phase 6 security review). Runs after the guards, so
 * it only counts authenticated user/psikolog calls; public and service-to-service routes have
 * their own protections. Redis trouble never blocks a request.
 */
@Injectable()
export class RateLimitInterceptor implements NestInterceptor {
  private readonly limit: number;

  constructor(
    private readonly redis: RedisService,
    config: ConfigService<Environment, true>,
  ) {
    this.limit = config.get('REST_RATE_LIMIT_PER_MINUTE', { infer: true });
  }

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    const principal = context
      .switchToHttp()
      .getRequest<AiRequest>().aiPrincipal;
    if (principal) {
      const count = await this.redis
        .hit(`rest:${principal.role}:${principal.sub}`, 60)
        .catch(() => 0);
      if (count > this.limit) {
        throw new HttpException(
          {
            code: 'RATE_LIMITED',
            message: 'Terlalu banyak permintaan, coba lagi sebentar lagi',
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }
    return next.handle();
  }
}
