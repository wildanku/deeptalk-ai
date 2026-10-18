import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { createClient, type RedisClientType } from 'redis';
import { DrainService } from '../common/drain/drain.service';
import type { Environment } from '../config/env.schema';

// Deletes the key only if it still holds our token, so a lock that expired and was taken by
// another instance is never released by mistake.
const RELEASE_SCRIPT = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
end
return 0`;

/** Shared Redis client for cross-instance coordination (locks). Socket.IO has its own. */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly client: RedisClientType;
  private readonly prefix: string;

  constructor(
    config: ConfigService<Environment, true>,
    private readonly drainService: DrainService,
  ) {
    this.client = createClient({
      url: config.get('REDIS_URL', { infer: true }),
    });
    this.prefix = `${config.get('REDIS_PREFIX', { infer: true })}:`;
    this.client.on('error', (error: Error) =>
      this.logger.warn({ err: { name: error.name } }, 'Redis client error'),
    );
  }

  async onModuleInit(): Promise<void> {
    await this.client.connect();
  }

  async onModuleDestroy(): Promise<void> {
    // In-flight turns still need to release their locks.
    await this.drainService.drain();
    if (this.client.isOpen) await this.client.close();
  }

  /** Returns a release token, or `null` when the lock is held elsewhere. */
  async tryLock(key: string, ttlMs: number): Promise<string | null> {
    const token = randomUUID();
    const result = await this.client.set(`${this.prefix}${key}`, token, {
      condition: 'NX',
      expiration: { type: 'PX', value: ttlMs },
    });
    return result === 'OK' ? token : null;
  }

  async release(key: string, token: string): Promise<void> {
    await this.client.eval(RELEASE_SCRIPT, {
      keys: [`${this.prefix}${key}`],
      arguments: [token],
    });
  }

  async isLocked(key: string): Promise<boolean> {
    return (await this.client.exists(`${this.prefix}${key}`)) === 1;
  }

  async getJson<T>(key: string): Promise<T | null> {
    const raw = await this.client.get(`${this.prefix}${key}`);
    return raw ? (JSON.parse(raw) as T) : null;
  }

  async setJson(
    key: string,
    value: unknown,
    ttlSeconds: number,
  ): Promise<void> {
    await this.client.set(`${this.prefix}${key}`, JSON.stringify(value), {
      expiration: { type: 'EX', value: ttlSeconds },
    });
  }

  /** Fixed-window counter; returns the count after incrementing. */
  async hit(key: string, windowSeconds: number): Promise<number> {
    const full = `${this.prefix}${key}`;
    const count = await this.client.incr(full);
    if (count === 1) await this.client.expire(full, windowSeconds);
    return count;
  }

  async exists(key: string): Promise<boolean> {
    return (await this.client.exists(`${this.prefix}${key}`)) > 0;
  }

  async del(key: string): Promise<void> {
    await this.client.del(`${this.prefix}${key}`);
  }

  async ping(): Promise<boolean> {
    return (await this.client.ping()) === 'PONG';
  }
}
