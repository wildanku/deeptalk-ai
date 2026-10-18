import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { uuidv7 } from 'uuidv7';
import { AgentClient } from '../agent-client/agent-client.service';
import type { Environment } from '../config/env.schema';
import { personaCardSchema } from '../content/content.schemas';
import { ContentService } from '../content/content.service';
import { PrismaService } from '../database/prisma.service';
import type { ai_eval_runs } from '../generated/prisma/client';
import { TaskHandlers } from '../tasks/task-handlers';
import { EVALS_QUEUE, TASK_QUEUE, type TaskQueue } from '../tasks/task-queue';

export interface Readiness {
  ok: boolean;
  reason: string | null;
  run_id: string | null;
}

export interface RunSummary {
  run_id: string;
  status: string;
  total: number;
  rated: number;
  unsafe: number;
}

/**
 * Persona evaluation (02 §12.1): the persona version answers every `eval` case the psikolog
 * wrote, through the same safety layers as a real turn; the psikolog rates each answer (safe,
 * on style, notes). A version can only be approved after a completed run in which every answer
 * was rated, all of them safe.
 */
@Injectable()
export class EvalRunsService implements OnModuleInit {
  private readonly logger = new Logger(EvalRunsService.name);
  readonly minCases: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly content: ContentService,
    private readonly agent: AgentClient,
    @Inject(TASK_QUEUE) private readonly queue: TaskQueue,
    private readonly handlers: TaskHandlers,
    config: ConfigService<Environment, true>,
  ) {
    this.minCases = config.get('PERSONA_MIN_EVAL_CASES', { infer: true });
  }

  onModuleInit(): void {
    this.handlers.register(EVALS_QUEUE, (payload) =>
      this.execute(String(payload.runId)),
    );
  }

  async start(
    personaId: string,
    version: number,
    createdBy: string,
  ): Promise<ai_eval_runs> {
    const card = await this.prisma.ai_content_versions.findUnique({
      where: {
        kind_ref_id_version: {
          kind: 'persona_card',
          ref_id: personaId,
          version,
        },
      },
      select: { id: true },
    });
    if (!card) throw new NotFoundException('Versi persona tidak ditemukan');
    const cases = await this.prisma.ai_eval_cases.count({
      where: { persona_id: personaId, usage: 'eval' },
    });
    if (cases < this.minCases) {
      throw new BadRequestException({
        code: 'EVAL_CASES_REQUIRED',
        message: `Jawab minimal ${this.minCases} studi kasus evaluasi dulu (baru ${cases}).`,
      });
    }
    const running = await this.prisma.ai_eval_runs.findFirst({
      where: {
        persona_id: personaId,
        persona_version: version,
        status: { in: ['queued', 'running'] },
      },
    });
    if (running) return running;
    const run = await this.prisma.ai_eval_runs.create({
      data: {
        id: uuidv7(),
        persona_id: personaId,
        persona_version: version,
        created_by: createdBy,
      },
    });
    // One case per agent call; a long run gets the maximum Cloud Tasks deadline.
    await this.queue.enqueue(EVALS_QUEUE, {
      name: `eval-${run.id}`,
      payload: { runId: run.id },
      deadlineSeconds: 1800,
    });
    return run;
  }

  /** Task handler. Resumable: cases already answered in this run are skipped. */
  async execute(runId: string): Promise<void> {
    const run = await this.prisma.ai_eval_runs.findUnique({
      where: { id: runId },
    });
    if (!run || run.status === 'completed' || run.status === 'failed') return;
    await this.prisma.ai_eval_runs.update({
      where: { id: runId },
      data: { status: 'running', started_at: run.started_at ?? new Date() },
    });
    try {
      const [cardRow, persona, cases, answered] = await Promise.all([
        this.prisma.ai_content_versions.findUniqueOrThrow({
          where: {
            kind_ref_id_version: {
              kind: 'persona_card',
              ref_id: run.persona_id,
              version: run.persona_version,
            },
          },
        }),
        this.prisma.ai_personas.findUnique({ where: { id: run.persona_id } }),
        this.prisma.ai_eval_cases.findMany({
          where: { persona_id: run.persona_id, usage: 'eval' },
          orderBy: { case_ref: 'asc' },
        }),
        this.prisma.ai_eval_ratings.findMany({
          where: { run_id: runId },
          select: { case_id: true },
        }),
      ]);
      const card = personaCardSchema.parse(cardRow.body);
      const knowledge = (await this.content.listActive('knowledge'))
        .filter((item) => card.focus_topics.includes(item.body.topic))
        .map((item) => item.body);
      const done = new Set(answered.map((row) => row.case_id));
      let model: string | null = null;
      let promptVersion: string | null = null;
      for (const evalCase of cases) {
        if (done.has(evalCase.id)) continue;
        const result = await this.agent.evalRun({
          persona: {
            id: run.persona_id,
            display_name: persona?.display_name ?? run.persona_id,
            version: run.persona_version,
            card,
          },
          knowledge,
          cases: [{ case_id: evalCase.id, scenario: evalCase.scenario }],
        });
        const answer = result.results.find((r) => r.case_id === evalCase.id);
        if (!answer) throw new Error('missing eval result');
        model = result.model;
        promptVersion = result.prompt_version;
        await this.prisma.ai_eval_ratings.create({
          data: {
            id: uuidv7(),
            run_id: runId,
            case_id: evalCase.id,
            ai_response: answer.response.slice(0, 8000),
            risk_level: answer.risk_level,
            replaced: answer.replaced,
          },
        });
      }
      await this.prisma.ai_eval_runs.update({
        where: { id: runId },
        data: {
          status: 'completed',
          completed_at: new Date(),
          model,
          prompt_version: promptVersion,
        },
      });
    } catch (error) {
      this.logger.error({
        eval_run: runId,
        err: { name: error instanceof Error ? error.name : typeof error },
      });
      await this.prisma.ai_eval_runs.update({
        where: { id: runId },
        data: { status: 'failed', completed_at: new Date() },
      });
    }
  }

  async view(personaId: string, runId: string) {
    const run = await this.prisma.ai_eval_runs.findFirst({
      where: { id: runId, persona_id: personaId },
      include: { ratings: { orderBy: { created_at: 'asc' } } },
    });
    if (!run) throw new NotFoundException('Evaluasi tidak ditemukan');
    const cases = await this.prisma.ai_eval_cases.findMany({
      where: { id: { in: run.ratings.map((rating) => rating.case_id) } },
    });
    const byId = new Map(cases.map((item) => [item.id, item]));
    return {
      id: run.id,
      persona_version: run.persona_version,
      status: run.status,
      model: run.model,
      prompt_version: run.prompt_version,
      created_at: run.created_at.toISOString(),
      completed_at: run.completed_at?.toISOString() ?? null,
      ratings: run.ratings.map((rating) => {
        const evalCase = byId.get(rating.case_id);
        return {
          id: rating.id,
          case_ref: evalCase?.case_ref ?? null,
          scenario: evalCase?.scenario ?? null,
          ideal_response: evalCase?.ideal_response ?? null,
          expected_risk_level: evalCase?.expected_risk_level ?? null,
          ai_response: rating.ai_response,
          risk_level: rating.risk_level,
          replaced: rating.replaced,
          safe: rating.safe,
          on_style: rating.on_style,
          notes: rating.notes,
          rated_at: rating.rated_at?.toISOString() ?? null,
        };
      }),
    };
  }

  async rate(
    personaId: string,
    runId: string,
    ratingId: string,
    raterId: string,
    input: { safe: boolean; on_style: boolean; notes?: string | null },
  ) {
    const run = await this.prisma.ai_eval_runs.findFirst({
      where: { id: runId, persona_id: personaId },
    });
    if (!run) throw new NotFoundException('Evaluasi tidak ditemukan');
    if (run.status !== 'completed')
      throw new ConflictException('Evaluasi belum selesai');
    const { count } = await this.prisma.ai_eval_ratings.updateMany({
      where: { id: ratingId, run_id: runId },
      data: {
        safe: input.safe,
        on_style: input.on_style,
        notes: input.notes ?? null,
        rater_id: raterId,
        rated_at: new Date(),
      },
    });
    if (count === 0) throw new NotFoundException('Respons tidak ditemukan');
    return this.view(personaId, runId);
  }

  /** Latest run per version, for the version list. */
  async summaries(personaId: string): Promise<Map<number, RunSummary>> {
    const runs = await this.prisma.ai_eval_runs.findMany({
      where: { persona_id: personaId },
      orderBy: { created_at: 'desc' },
      include: { ratings: { select: { safe: true, on_style: true } } },
    });
    const result = new Map<number, RunSummary>();
    for (const run of runs) {
      if (result.has(run.persona_version)) continue;
      result.set(run.persona_version, {
        run_id: run.id,
        status: run.status,
        total: run.ratings.length,
        rated: run.ratings.filter((r) => r.safe !== null && r.on_style !== null)
          .length,
        unsafe: run.ratings.filter((r) => r.safe === false).length,
      });
    }
    return result;
  }

  /** Whether a version may be approved: latest completed run fully rated, all safe. */
  async readiness(personaId: string, version: number): Promise<Readiness> {
    const run = await this.prisma.ai_eval_runs.findFirst({
      where: {
        persona_id: personaId,
        persona_version: version,
        status: 'completed',
      },
      orderBy: { created_at: 'desc' },
      include: { ratings: true },
    });
    if (!run)
      return {
        ok: false,
        reason: 'Jalankan evaluasi untuk versi ini dulu.',
        run_id: null,
      };
    const ratings = run.ratings;
    if (ratings.length < this.minCases)
      return {
        ok: false,
        reason: `Evaluasi butuh minimal ${this.minCases} studi kasus.`,
        run_id: run.id,
      };
    if (ratings.some((r) => r.safe === null || r.on_style === null))
      return { ok: false, reason: 'Nilai semua respons dulu.', run_id: run.id };
    if (ratings.some((r) => r.safe === false))
      return {
        ok: false,
        reason:
          'Ada respons yang dinilai tidak aman. Perbaiki persona lalu evaluasi ulang.',
        run_id: run.id,
      };
    return { ok: true, reason: null, run_id: run.id };
  }
}
