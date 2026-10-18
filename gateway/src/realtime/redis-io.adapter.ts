import { INestApplicationContext, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient, RedisClientType } from 'redis';
import { Server, ServerOptions } from 'socket.io';
import { buildCorsOptions } from '../common/http/cors';

export class RedisIoAdapter extends IoAdapter {
  private readonly redisLogger = new Logger(RedisIoAdapter.name);
  private adapter?: ReturnType<typeof createAdapter>;
  private pubClient?: RedisClientType;
  private subClient?: RedisClientType;

  constructor(
    app: INestApplicationContext,
    private readonly configService: ConfigService,
  ) {
    super(app);
  }

  async connectToRedis(): Promise<boolean> {
    const url = this.configService.getOrThrow<string>('REDIS_URL');
    const pubClient = createClient({ url });
    const subClient = pubClient.duplicate();
    pubClient.on('error', (error: Error) =>
      this.redisLogger.warn(
        `Socket.IO Redis publisher error: ${error.message}`,
      ),
    );
    subClient.on('error', (error: Error) =>
      this.redisLogger.warn(
        `Socket.IO Redis subscriber error: ${error.message}`,
      ),
    );

    try {
      await Promise.all([pubClient.connect(), subClient.connect()]);
      this.pubClient = pubClient;
      this.subClient = subClient;
      this.adapter = createAdapter(pubClient, subClient);
      return true;
    } catch (error) {
      this.redisLogger.warn(
        `Socket.IO will run in single-node mode because Redis is unavailable: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
      await Promise.allSettled([
        pubClient.disconnect(),
        subClient.disconnect(),
      ]);
      return false;
    }
  }

  /**
   * Every namespace shares one Socket.IO server, created from whichever gateway Nest scans
   * first — so per-gateway `cors` options would silently race. The HTTP policy
   * (`CORS_ORIGINS`) is applied here instead, for all namespaces.
   */
  createIOServer(port: number, options?: ServerOptions): Server {
    const server = super.createIOServer(port, {
      ...options,
      cors: buildCorsOptions(this.configService.get<string>('CORS_ORIGINS')),
      // 02 §9.1: bound event size. A 2,000-character message is < 8 KB even in 4-byte UTF-8.
      maxHttpBufferSize: 16 * 1024,
    }) as Server;
    if (this.adapter) {
      server.adapter(this.adapter);
    }
    return server;
  }

  /**
   * Called by Nest's `SocketModule.close()` during `app.close()` / shutdown hooks. Idempotent:
   * `redis` v5+ throws `ClientClosedError` when closing an already-closed client, and a throw
   * here makes Nest's shutdown handler `process.exit(1)`. A client that is still reconnecting
   * (Redis unreachable) is destroyed instead of closed, since `close()` would wait on its queue.
   */
  async dispose(): Promise<void> {
    const clients = [this.pubClient, this.subClient].filter(
      (client): client is RedisClientType => client !== undefined,
    );
    this.pubClient = undefined;
    this.subClient = undefined;
    const results = await Promise.allSettled(
      clients
        .filter((client) => client.isOpen)
        .map(async (client) => {
          if (client.isReady) {
            await client.close();
          } else {
            client.destroy();
          }
        }),
    );
    for (const result of results) {
      if (result.status === 'rejected') {
        this.redisLogger.warn(
          `Failed to close Socket.IO Redis client: ${
            result.reason instanceof Error
              ? result.reason.message
              : 'unknown error'
          }`,
        );
      }
    }
  }
}
