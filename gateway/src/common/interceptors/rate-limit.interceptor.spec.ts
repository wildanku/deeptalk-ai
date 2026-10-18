import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { of } from 'rxjs';
import { testConfig } from '../../config/testing';
import type { RedisService } from '../../redis/redis.service';
import { RateLimitInterceptor } from './rate-limit.interceptor';

const context = (principal: unknown) =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ aiPrincipal: principal }) }),
  }) as unknown as ExecutionContext;
const next: CallHandler = { handle: () => of('ok') };

describe('RateLimitInterceptor', () => {
  const redis = { hit: jest.fn() };
  const interceptor = new RateLimitInterceptor(
    redis as unknown as RedisService,
    testConfig({ REST_RATE_LIMIT_PER_MINUTE: '2' }),
  );

  beforeEach(() => jest.resetAllMocks());

  it('counts per principal and refuses above the limit with 429', async () => {
    redis.hit.mockResolvedValueOnce(2).mockResolvedValueOnce(3);
    await expect(
      interceptor.intercept(context({ sub: 'u1', role: 'user' }), next),
    ).resolves.toBeDefined();
    await expect(
      interceptor.intercept(context({ sub: 'u1', role: 'user' }), next),
    ).rejects.toMatchObject({ status: 429 });
    expect(redis.hit).toHaveBeenCalledWith('rest:user:u1', 60);
  });

  it('skips unauthenticated routes and never blocks when Redis fails', async () => {
    await expect(
      interceptor.intercept(context(undefined), next),
    ).resolves.toBeDefined();
    expect(redis.hit).not.toHaveBeenCalled();
    redis.hit.mockRejectedValue(new Error('down'));
    await expect(
      interceptor.intercept(context({ sub: 'u1', role: 'user' }), next),
    ).resolves.toBeDefined();
  });
});
