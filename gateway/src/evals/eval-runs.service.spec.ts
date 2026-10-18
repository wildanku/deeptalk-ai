import { testConfig } from '../config/testing';
import type { AgentClient } from '../agent-client/agent-client.service';
import type { ContentService } from '../content/content.service';
import type { PrismaService } from '../database/prisma.service';
import { EvalRunsService } from './eval-runs.service';
import { personaIdFor } from './persona-workspace.service';

describe('EvalRunsService.readiness', () => {
  const prisma = { ai_eval_runs: { findFirst: jest.fn() } };
  const service = new EvalRunsService(
    prisma as unknown as PrismaService,
    {} as ContentService,
    {} as AgentClient,
    { enqueue: jest.fn() },
    { register: jest.fn() } as never,
    testConfig({ PERSONA_MIN_EVAL_CASES: '2' }),
  );
  const rating = (safe: boolean | null, onStyle: boolean | null = true) => ({
    safe,
    on_style: onStyle,
  });

  it('needs a completed run', async () => {
    prisma.ai_eval_runs.findFirst.mockResolvedValue(null);
    await expect(service.readiness('p', 1)).resolves.toMatchObject({
      ok: false,
    });
  });

  it('needs every answer rated, and all of them safe', async () => {
    prisma.ai_eval_runs.findFirst.mockResolvedValue({
      id: 'r',
      ratings: [rating(true), rating(null)],
    });
    await expect(service.readiness('p', 1)).resolves.toMatchObject({
      ok: false,
      reason: 'Nilai semua respons dulu.',
    });
    prisma.ai_eval_runs.findFirst.mockResolvedValue({
      id: 'r',
      ratings: [rating(true), rating(false)],
    });
    await expect(service.readiness('p', 1)).resolves.toMatchObject({
      ok: false,
    });
    prisma.ai_eval_runs.findFirst.mockResolvedValue({
      id: 'r',
      ratings: [rating(true)],
    });
    await expect(service.readiness('p', 1)).resolves.toMatchObject({
      ok: false,
    });
    prisma.ai_eval_runs.findFirst.mockResolvedValue({
      id: 'r',
      ratings: [rating(true, false), rating(true)],
    });
    await expect(service.readiness('p', 1)).resolves.toEqual({
      ok: true,
      reason: null,
      run_id: 'r',
    });
  });
});

describe('personaIdFor', () => {
  it('is a stable slug within 64 characters', () => {
    expect(personaIdFor('PSY-01 A')).toBe('ps-psy-01-a');
    expect(personaIdFor('x'.repeat(100))).toHaveLength(64);
  });
});
