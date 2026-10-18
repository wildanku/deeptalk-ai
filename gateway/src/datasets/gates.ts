import { ForbiddenException } from '@nestjs/common';
import type { AiDataGate } from '../generated/prisma/client';

export const DATA_GATES: readonly AiDataGate[] = [
  'dpia',
  'ethics_review',
  'fine_tuning_go',
];

/** Every job that touches conversation data needs both (Konsep §7.4 step 4). */
export const BASE_GATES: readonly AiDataGate[] = ['dpia', 'ethics_review'];

export interface GateRow {
  gate: AiDataGate;
  approved: boolean;
  recorded_by: string;
  reference: string;
  created_at: Date;
}

export interface GateState {
  gate: AiDataGate;
  approved: boolean;
  recorded_by: string | null;
  reference: string | null;
  at: string | null;
}

/** Newest row per gate decides; a gate never recorded is closed. */
export function gateStates(rows: GateRow[]): GateState[] {
  return DATA_GATES.map((gate) => {
    const latest = rows
      .filter((row) => row.gate === gate)
      .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())[0];
    return {
      gate,
      approved: latest?.approved ?? false,
      recorded_by: latest?.recorded_by ?? null,
      reference: latest?.reference ?? null,
      at: latest?.created_at.toISOString() ?? null,
    };
  });
}

export class DatasetBlockedError extends ForbiddenException {
  constructor(readonly missing: string[]) {
    super({
      code: 'DATASET_BLOCKED',
      message: `Belum ada persetujuan yang sah: ${missing.join(', ')}`,
    });
  }
}

/**
 * Throws unless the switch is on and every required gate is approved. Nothing in Phase 9 may
 * run ahead of a legitimate approval (03 Phase 9).
 */
export function assertOpen(
  enabled: boolean,
  states: GateState[],
  required: readonly AiDataGate[],
): void {
  const missing = [
    ...(enabled ? [] : ['DATASET_ENABLED']),
    ...required.filter(
      (gate) => !states.find((state) => state.gate === gate)?.approved,
    ),
  ];
  if (missing.length > 0) throw new DatasetBlockedError(missing);
}
