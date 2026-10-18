import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { ResponseInterceptor } from '../src/common/interceptors/response.interceptor';
import { DatabaseModule } from '../src/database/database.module';
import { PrismaService } from '../src/database/prisma.service';
import { HealthModule } from '../src/health/health.module';

describe('GET /v1/health (e2e)', () => {
  let app: INestApplication<App>;
  const prisma = { $queryRaw: jest.fn() };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule, HealthModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalInterceptors(new ResponseInterceptor());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('wraps the health check in the success envelope', async () => {
    prisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);

    await request(app.getHttpServer())
      .get('/v1/health')
      .expect(200)
      .expect({
        success: true,
        data: { status: 'ok', database: 'connected' },
      });
  });

  it('answers 503 with the error envelope when the database is down', async () => {
    prisma.$queryRaw.mockRejectedValue(new Error('connection refused'));

    const response = await request(app.getHttpServer())
      .get('/v1/health')
      .expect(503);

    expect(response.body).toMatchObject({
      success: false,
      message: 'Database is unavailable',
      path: '/v1/health',
    });
  });
});
