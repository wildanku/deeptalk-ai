import { ConfigService } from '@nestjs/config';
import { type Environment, validateEnvironment } from './env.schema';

/** Typed ConfigService for specs, with the same defaults and validation as runtime. */
export function testConfig(
  overrides: Record<string, unknown> = {},
): ConfigService<Environment, true> {
  return new ConfigService<Environment, true>(
    validateEnvironment({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://test@localhost:5432/test',
      ...overrides,
    }),
  );
}
