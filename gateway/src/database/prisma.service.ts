import {
  INestApplication,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { DrainService } from '../common/drain/drain.service';
import { PrismaClient } from '../generated/prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor(private readonly drainService: DrainService) {
    super({
      adapter: new PrismaPg({
        connectionString: process.env.DATABASE_URL,
        // Per instance; Postgres' max_connections is shared by every instance.
        max: Number(process.env.DATABASE_POOL_MAX ?? 10),
        // Starvation surfaces as an error instead of a silent hang (Phase 6 load test).
        connectionTimeoutMillis: 10_000,
      }),
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    // Let in-flight turns store their replies before the pool closes.
    await this.drainService.drain();
    await this.$disconnect();
  }

  enableShutdownHooks(app: INestApplication): void {
    process.once('beforeExit', () => void app.close());
  }
}
