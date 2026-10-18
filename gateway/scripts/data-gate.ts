/**
 * Records an approval gate for training-data use (03 Phase 9). Run by an engineer only on
 * written instruction from the owner of the approval (legal for `dpia`, the external ethics
 * reviewer for `ethics_review`, Pak Novri + Wildan for `fine_tuning_go`). Append-only.
 *
 *   DATABASE_URL=… pnpm run data:gate -- status
 *   DATABASE_URL=… pnpm run data:gate -- <dpia|ethics_review|fine_tuning_go> --by <who> --ref <document> [--revoke]
 */
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { DATA_GATES, gateStates } from '../src/datasets/gates';

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((a) => a !== '--');
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  try {
    const [gate] = args;
    if (gate === 'status') {
      for (const state of gateStates(await prisma.ai_data_gates.findMany())) {
        process.stdout.write(
          `${state.approved ? 'OPEN  ' : 'CLOSED'}  ${state.gate}${
            state.at ? ` — ${state.recorded_by}, ${state.reference}, ${state.at}` : ''
          }\n`,
        );
      }
      return;
    }
    const by = args[args.indexOf('--by') + 1];
    const ref = args[args.indexOf('--ref') + 1];
    if (
      !DATA_GATES.includes(gate as (typeof DATA_GATES)[number]) ||
      !args.includes('--by') ||
      !args.includes('--ref') ||
      !by ||
      !ref
    ) {
      throw new Error(
        'usage: data:gate status | data:gate <dpia|ethics_review|fine_tuning_go> --by <who> --ref <document> [--revoke]',
      );
    }
    const approved = !args.includes('--revoke');
    await prisma.ai_data_gates.create({
      data: {
        id: randomUUID(),
        gate: gate as (typeof DATA_GATES)[number],
        approved,
        recorded_by: by.slice(0, 255),
        reference: ref.slice(0, 500),
      },
    });
    process.stdout.write(`${approved ? 'opened' : 'closed'} ${gate} (by ${by}, ref ${ref})\n`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Error'}\n`);
  process.exitCode = 1;
});
