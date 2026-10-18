/**
 * Rollout readiness (03 Phase 7): the stage gates that can be read from the database, plus the
 * ones that need a person (printed as reminders). Read-only. Exit 1 when an automatic gate fails.
 *
 *   DATABASE_URL=<read-only> pnpm run rollout:readiness -- --stage internal|beta|percentage|ga
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { personaGateFailure } from './check-persona-evals';
import {
  approvedKnowledge,
  knowledgeBudget,
  limitsFromEnv,
} from './knowledge-budget';

type Stage = 'internal' | 'beta' | 'percentage' | 'ga';

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

/** Gates every stage needs before it opens (03 Phase 7 table and 03 §4). */
export function contentChecks(input: {
  approvedKinds: Record<string, string[]>;
  activePersonaFailures: string[];
  activePersonas: number;
}): Check[] {
  const has = (kind: string, ref?: string) =>
    (input.approvedKinds[kind] ?? []).some(
      (r) => ref === undefined || r === ref,
    );
  return [
    {
      name: 'Protokol crisis approved',
      ok: has('protocol', 'crisis'),
      detail: 'content protocol/crisis',
    },
    {
      name: 'Protokol elevated approved',
      ok: has('protocol', 'elevated'),
      detail: 'content protocol/elevated',
    },
    {
      name: 'Frasa L1 approved',
      ok: has('l1_phrases'),
      detail: 'content l1_phrases',
    },
    {
      name: 'Teks consent layanan approved',
      ok: has('consent_text', 'service'),
      detail: 'content consent_text/service',
    },
    {
      name: 'Minimal satu persona aktif',
      ok: input.activePersonas > 0,
      detail: `${input.activePersonas} persona aktif`,
    },
    {
      name: 'Setiap persona aktif lolos gerbang evaluasi',
      ok: input.activePersonaFailures.length === 0,
      detail: input.activePersonaFailures.join('; ') || 'semua lolos',
    },
  ];
}

export function safetyChecks(input: {
  openCrisisEvents: number;
  openHarmfulReports: number;
}): Check[] {
  return [
    {
      name: 'Tidak ada kejadian crisis yang belum ditinjau',
      ok: input.openCrisisEvents === 0,
      detail: `${input.openCrisisEvents} belum ditinjau`,
    },
    {
      name: 'Tidak ada laporan respons "berbahaya" yang belum ditinjau',
      ok: input.openHarmfulReports === 0,
      detail: `${input.openHarmfulReports} belum ditinjau`,
    },
  ];
}

const MANUAL: Record<Stage, string[]> = {
  internal: [
    'Blocker konten klinis, teks hukum, GCP, dan on-call (Q12) sudah RESOLVED',
    'v3: AI_ROLLOUT_MODE=allowlist, AI_ALLOWED_USER_IDS = tim + psikolog',
  ],
  beta: [
    'Tahap internal: umpan balik psikolog ditindaklanjuti (tinjauan pasca-tahap tertulis)',
    'SLO terpenuhi (dashboard monitoring, 7 hari terakhir)',
    'Tinjauan sampel percakapan oleh psikolog — hanya dengan consent pengguna; kebijakan Q5',
  ],
  percentage: [
    'Tahap beta: tinjauan pasca-tahap tanpa temuan kritis',
    'Uji beban `staging` untuk persentase berikutnya lulus (e2e/load.mjs atau setara)',
    'Biaya per sesi stabil (dashboard: session_tokens_output) dan anggaran cukup',
  ],
  ga: [
    'Setiap kenaikan persentase: SLO dan biaya per sesi stabil',
    'Keputusan bersama Pak Novri dan Wildan',
  ],
};

async function main(): Promise<void> {
  const stageArg = process.argv[process.argv.indexOf('--stage') + 1] as
    Stage | undefined;
  const stage: Stage = stageArg && stageArg in MANUAL ? stageArg : 'internal';
  const minCases = Number(process.env.PERSONA_MIN_EVAL_CASES ?? '5');
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  try {
    const approved = await prisma.ai_content_versions.findMany({
      where: { status: 'approved' },
      select: { kind: true, ref_id: true },
    });
    const approvedKinds: Record<string, string[]> = {};
    for (const row of approved)
      (approvedKinds[row.kind] ??= []).push(row.ref_id);

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

    const [openCrisisEvents, openHarmfulReports] = await Promise.all([
      prisma.ai_safety_events.count({
        where: { level: 'crisis', reviewed_at: null },
      }),
      prisma.ai_message_reports.count({
        where: { reason: 'harmful', reviewed_at: null },
      }),
    ]);

    const checks = [
      ...contentChecks({
        approvedKinds,
        activePersonaFailures: failures,
        activePersonas: personas.length,
      }),
      ...safetyChecks({ openCrisisEvents, openHarmfulReports }),
      knowledgeBudget(await approvedKnowledge(prisma), limitsFromEnv()).check,
    ];
    process.stdout.write(`Kesiapan tahap: ${stage}\n\nOtomatis:\n`);
    for (const check of checks) {
      process.stdout.write(
        `  ${check.ok ? 'PASS' : 'FAIL'}  ${check.name} — ${check.detail}\n`,
      );
    }
    process.stdout.write('\nManual (cek dan catat di tinjauan pasca-tahap):\n');
    for (const item of MANUAL[stage]) process.stdout.write(`  [ ] ${item}\n`);
    if (checks.some((check) => !check.ok)) process.exitCode = 1;
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
