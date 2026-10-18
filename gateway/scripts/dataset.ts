/**
 * Training-data jobs (03 Phase 9, Konsep §7.4). Every command refuses to run unless
 * `DATASET_ENABLED=true` and the approval gates are recorded (`pnpm run data:gate`).
 * Prints counts only.
 *
 *   pnpm run dataset -- status
 *   pnpm run dataset -- collect [--limit 200]
 *   pnpm run dataset -- import-legacy <extraction.jsonl>
 *   pnpm run dataset -- export --purpose evaluation|style_examples|fine_tuning --out <file.jsonl> --by <who>
 *
 * `--out` must be on restricted storage in asia-southeast2 (docs/data/pemanfaatan-data.md).
 */
import 'dotenv/config';
import 'reflect-metadata';
import { readFileSync, writeFileSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import { DatasetsCliModule } from '../src/datasets/datasets-cli.module';
import { DatasetsService } from '../src/datasets/datasets.service';
import type { AiDatasetPurpose } from '../src/generated/prisma/client';

const PURPOSES: AiDatasetPurpose[] = ['evaluation', 'style_examples', 'fine_tuning'];

function arg(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

const print = (value: unknown) => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2).filter((a) => a !== '--');
  const app = await NestFactory.createApplicationContext(DatasetsCliModule, {
    logger: ['error', 'warn'],
  });
  try {
    const datasets = app.get(DatasetsService);
    switch (command) {
      case 'status':
        print(await datasets.summary());
        break;
      case 'collect':
        print(await datasets.collectTemanAi(Number(arg(args, '--limit') ?? 200)));
        break;
      case 'import-legacy': {
        const file = args[0];
        if (!file) throw new Error('usage: dataset import-legacy <extraction.jsonl>');
        const records = readFileSync(file, 'utf8')
          .split('\n')
          .filter((line) => line.trim())
          .map((line) => JSON.parse(line) as unknown);
        print(await datasets.importLegacy(records));
        break;
      }
      case 'export': {
        const purpose = arg(args, '--purpose') as AiDatasetPurpose | undefined;
        const out = arg(args, '--out');
        const by = arg(args, '--by');
        if (!purpose || !PURPOSES.includes(purpose) || !out || !by) {
          throw new Error(
            'usage: dataset export --purpose evaluation|style_examples|fine_tuning --out <file> --by <who>',
          );
        }
        const { manifest, items } = await datasets.export(purpose, by);
        writeFileSync(out, items.map((item) => JSON.stringify(item)).join('\n') + '\n', {
          mode: 0o600,
          flag: 'wx',
        });
        print(manifest);
        break;
      }
      default:
        throw new Error('usage: dataset status|collect|import-legacy|export');
    }
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  // Name and message only: messages from this code carry counts and gate names, never content.
  const message = error instanceof Error ? `${error.name}: ${error.message}` : 'Error';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
