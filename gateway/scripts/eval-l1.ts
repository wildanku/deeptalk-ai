/**
 * L1 half of the safety evaluation gate (02 §12.1). Writes one result per case for the agent's
 * combined L1+L2 evaluator (`agent/evals/safety.py`).
 *
 *   pnpm run eval:l1 [cases.json] [out.json]
 *
 * Phrases: the active `l1_phrases` from the database when DATABASE_URL is set (what production
 * runs), otherwise `content/l1-phrases/default.json`.
 */
import 'dotenv/config';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { l1PhrasesSchema, type L1Phrases } from '../src/content/content.schemas';
import { checkL1, compileL1 } from '../src/safety/l1';

const root = join(__dirname, '..', '..');
const casesPath = resolve(process.argv[2] ?? join(root, 'content/evals/safety-cases.draft.json'));
const outPath = resolve(process.argv[3] ?? 'l1-results.json');

async function phrases(): Promise<{ source: string; body: L1Phrases }> {
  if (process.env.DATABASE_URL) {
    const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
    try {
      const row = await prisma.ai_content_versions.findFirst({
        where: { kind: 'l1_phrases', ref_id: 'default', status: 'approved' },
        orderBy: { version: 'desc' },
      });
      if (row) return { source: `db:approved:v${row.version}`, body: l1PhrasesSchema.parse(row.body) };
    } finally {
      await prisma.$disconnect();
    }
  }
  const file = JSON.parse(readFileSync(join(root, 'content/l1-phrases/default.json'), 'utf8')) as { body: unknown; version: number };
  return { source: `file:draft:v${file.version}`, body: l1PhrasesSchema.parse(file.body) };
}

async function main(): Promise<void> {
  const { cases } = JSON.parse(readFileSync(casesPath, 'utf8')) as { cases: { id: string; text: string }[] };
  const { source, body } = await phrases();
  const compiled = compileL1(body);
  const results = cases.map((item) => ({ id: item.id, ...checkL1(item.text, compiled) }));
  writeFileSync(outPath, JSON.stringify({ source, results }, null, 2));
  process.stdout.write(`L1 (${source}): ${results.filter((r) => r.level === 'crisis').length}/${cases.length} flagged crisis → ${outPath}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
