/**
 * Seeds `../content` into the database as DRAFT (02 §8: bootstrap only; afterwards the database
 * is the source of truth and psikolog edit content in the dashboard).
 *
 *   DATABASE_URL=… pnpm run content:seed [content-dir]
 *
 * Append-only: an existing (kind, ref_id, version) is never overwritten. Changing a body
 * without bumping `version` is an error.
 */
import 'dotenv/config';
import { isDeepStrictEqual } from 'node:util';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { CONTENT_SCHEMAS, type ContentKind } from '../src/content/content.schemas';

interface Entry {
  kind: ContentKind;
  refId: string;
  version: number;
  body: unknown;
  file: string;
}

const dir = resolve(process.argv[2] ?? join(__dirname, '..', '..', 'content'));
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

function jsonFiles(path: string): string[] {
  return readdirSync(path).flatMap((name) => {
    const full = join(path, name);
    if (statSync(full).isDirectory()) return jsonFiles(full);
    return name.endsWith('.json') ? [full] : [];
  });
}

function entriesOf(file: string, data: Record<string, unknown>): Entry[] {
  const kind = data.kind as ContentKind | undefined;
  if (!kind || !(kind in CONTENT_SCHEMAS)) return [];
  const version = Number(data.version);
  if (Array.isArray(data.items)) {
    return (data.items as { ref_id: string; body: unknown }[]).map((item) => ({
      kind,
      refId: item.ref_id,
      version,
      body: item.body,
      file,
    }));
  }
  return [{ kind, refId: String(data.ref_id), version, body: data.body, file }];
}

async function main(): Promise<void> {
  const counts = { created: 0, unchanged: 0, personas: 0, psikologs: 0 };
  for (const file of jsonFiles(dir)) {
    const data = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;

    for (const entry of entriesOf(file, data)) {
      const parsed = CONTENT_SCHEMAS[entry.kind].safeParse(entry.body);
      if (!parsed.success) {
        throw new Error(`${entry.file} (${entry.refId}): ${parsed.error.message}`);
      }
      const existing = await prisma.ai_content_versions.findUnique({
        where: {
          kind_ref_id_version: { kind: entry.kind, ref_id: entry.refId, version: entry.version },
        },
      });
      if (existing) {
        if (!isDeepStrictEqual(existing.body, parsed.data)) {
          throw new Error(
            `${entry.kind}/${entry.refId} v${entry.version} already exists with a different body — bump "version"`,
          );
        }
        counts.unchanged += 1;
        continue;
      }
      await prisma.ai_content_versions.create({
        data: {
          id: randomUUID(),
          kind: entry.kind,
          ref_id: entry.refId,
          version: entry.version,
          body: parsed.data,
          status: 'draft',
          author_id: 'seed:content',
        },
      });
      counts.created += 1;
    }

    const persona = data.persona as
      | { id: string; psychologist_id: string; display_name: string }
      | undefined;
    if (persona) {
      await prisma.ai_personas.upsert({
        where: { id: persona.id },
        create: {
          id: persona.id,
          psychologist_id: persona.psychologist_id,
          display_name: persona.display_name,
        },
        update: {},
      });
      counts.personas += 1;
    }

    if (Array.isArray(data.mappings) && data.mappings.length > 0) {
      // Phase 5: mappings are versioned `assessment_mapping` content now (approved in the
      // dashboard), not rows written straight into the old table.
      throw new Error(`${file}: "mappings" is no longer supported — use kind "assessment_mapping" items`);
    }

    for (const id of (data.psychologist_ids as string[] | undefined) ?? []) {
      await prisma.ai_handoff_psikologs.upsert({
        where: { psychologist_id: id },
        create: { psychologist_id: id },
        update: {},
      });
      counts.psikologs += 1;
    }
  }
  process.stdout.write(`content seed: ${JSON.stringify(counts)}\n`);
}

main()
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
