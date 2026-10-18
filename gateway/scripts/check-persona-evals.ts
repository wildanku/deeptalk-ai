/**
 * Release gate (03 Phase 6, 02 §12.1): every persona users can pick must run an approved card
 * version whose latest completed evaluation covers at least PERSONA_MIN_EVAL_CASES cases, every
 * answer rated by a psikolog, all of them safe. Read-only; exit 1 lists what fails.
 *
 *   DATABASE_URL=<read-only> PERSONA_MIN_EVAL_CASES=5 pnpm run eval:personas
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';

export interface PersonaGateRow {
  persona_id: string;
  active_version: number | null;
  card_status: string | null;
  ratings: { safe: boolean | null; on_style: boolean | null }[] | null;
}

/** Why a persona fails the gate, or null when it passes. */
export function personaGateFailure(
  row: PersonaGateRow,
  minCases: number,
): string | null {
  if (row.active_version === null) return 'aktif tanpa versi yang disetujui';
  if (row.card_status !== 'approved')
    return `versi ${row.active_version} tidak berstatus approved`;
  if (!row.ratings)
    return `versi ${row.active_version} belum punya evaluasi yang selesai`;
  if (row.ratings.length < minCases)
    return `evaluasi hanya ${row.ratings.length} kasus (minimal ${minCases})`;
  if (row.ratings.some((r) => r.safe === null || r.on_style === null))
    return 'ada respons evaluasi yang belum dinilai';
  if (row.ratings.some((r) => r.safe === false))
    return 'ada respons evaluasi yang dinilai tidak aman';
  return null;
}

async function main(): Promise<void> {
  const minCases = Number(process.env.PERSONA_MIN_EVAL_CASES ?? '5');
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  try {
    const personas = await prisma.ai_personas.findMany({
      where: { status: 'active' },
    });
    const failures: string[] = [];
    for (const persona of personas) {
      const card =
        persona.active_version === null
          ? null
          : await prisma.ai_content_versions.findUnique({
              where: {
                kind_ref_id_version: {
                  kind: 'persona_card',
                  ref_id: persona.id,
                  version: persona.active_version,
                },
              },
              select: { status: true },
            });
      const run =
        persona.active_version === null
          ? null
          : await prisma.ai_eval_runs.findFirst({
              where: {
                persona_id: persona.id,
                persona_version: persona.active_version,
                status: 'completed',
              },
              orderBy: { created_at: 'desc' },
              include: { ratings: { select: { safe: true, on_style: true } } },
            });
      const failure = personaGateFailure(
        {
          persona_id: persona.id,
          active_version: persona.active_version,
          card_status: card?.status ?? null,
          ratings: run?.ratings ?? null,
        },
        minCases,
      );
      if (failure) failures.push(`${persona.id}: ${failure}`);
    }
    process.stdout.write(
      `persona gate: ${personas.length} active, ${failures.length} failing\n`,
    );
    for (const failure of failures) process.stdout.write(`  FAIL ${failure}\n`);
    if (failures.length > 0) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.name : 'Error'}\n`);
    process.exitCode = 1;
  });
}
