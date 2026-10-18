import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: {
    // `process.env` instead of `env()` so `prisma generate` works without a database
    // (CI, Docker build). Migrations: `migrate dev` against a local database only;
    // dev/staging/prod run `migrate deploy` from the pipeline (02 §8).
    url: process.env.DATABASE_URL,
  },
});
