import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { uuidv7 } from 'uuidv7';
import { AgentClient } from '../agent-client/agent-client.service';
import {
  type PersonaCard,
  personaCardSchema,
} from '../content/content.schemas';
import { ContentService } from '../content/content.service';
import { PrismaService } from '../database/prisma.service';
import type { ai_persona_workspaces, Prisma } from '../generated/prisma/client';
import { EvalRunsService } from './eval-runs.service';
import { personaStage } from './persona-status';

const MAX_ANSWER_CHARS = 4000;
const MAX_FEW_SHOTS = 8;
const TOPIC = /^[a-z0-9_]{2,64}$/;

/** One persona per psikolog; the slug is stable and never shown to users. */
export function personaIdFor(psychologistId: string): string {
  return `ps-${psychologistId.toLowerCase().replace(/[^a-z0-9_-]/g, '-')}`.slice(
    0,
    64,
  );
}

/**
 * "Persona saya" (Konsep §3.2, 03 Phase 5): questionnaire → case studies → draft Persona Card
 * (agent, tier Pro) → corrections (each a new version) → evaluation → approval by the psikolog
 * who owns the persona. A persona stays disabled until its first approved version; disabling
 * applies from the next turn of every running session (status is never cached).
 */
@Injectable()
export class PersonaWorkspaceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly content: ContentService,
    private readonly agent: AgentClient,
    private readonly evals: EvalRunsService,
  ) {}

  async workspace(psychologistId: string): Promise<ai_persona_workspaces> {
    return this.prisma.ai_persona_workspaces.upsert({
      where: { psychologist_id: psychologistId },
      create: {
        psychologist_id: psychologistId,
        persona_id: personaIdFor(psychologistId),
      },
      update: {},
    });
  }

  async view(psychologistId: string) {
    const ws = await this.workspace(psychologistId);
    const [questionnaire, cases, answers, versions, persona, runs] =
      await Promise.all([
        this.content.active('persona_questionnaire', 'default'),
        this.content.listActive('case_study'),
        this.prisma.ai_eval_cases.findMany({
          where: { persona_id: ws.persona_id },
        }),
        this.prisma.ai_content_versions.findMany({
          where: { kind: 'persona_card', ref_id: ws.persona_id },
          orderBy: { version: 'desc' },
        }),
        this.prisma.ai_personas.findUnique({ where: { id: ws.persona_id } }),
        this.evals.summaries(ws.persona_id),
      ]);
    const byRef = new Map(answers.map((answer) => [answer.case_ref, answer]));
    const stored = asAnswers(ws.answers);
    const required =
      questionnaire?.body.questions.filter((q) => q.required) ?? [];
    return {
      persona_id: ws.persona_id,
      display_name: ws.display_name,
      persona: persona
        ? {
            status: persona.status,
            active_version: persona.active_version,
            disabled_at: persona.disabled_at?.toISOString() ?? null,
          }
        : null,
      questionnaire: questionnaire
        ? {
            version: questionnaire.version,
            draft: questionnaire.status !== 'approved',
            questions: questionnaire.body.questions,
            answers: stored,
          }
        : null,
      cases: cases.map((item) => {
        const answer = byRef.get(item.refId);
        return {
          ref: item.refId,
          version: item.version,
          title: item.body.title,
          scenario: item.body.scenario,
          topic: item.body.topic ?? null,
          usage: item.body.usage,
          expected_risk_level: item.body.expected_risk_level,
          answer: answer?.ideal_response ?? null,
          answer_outdated: !!answer && answer.case_version !== item.version,
        };
      }),
      versions: versions.map((row) => ({
        version: row.version,
        status: row.status,
        card: row.body,
        created_at: row.created_at.toISOString(),
        approved_at: row.approved_at?.toISOString() ?? null,
        approved_by: row.approved_by,
        eval: runs.get(row.version) ?? null,
      })),
      requirements: {
        min_eval_cases: this.evals.minCases,
        eval_answered: answers.filter((a) => a.usage === 'eval').length,
        few_shot_answered: answers.filter((a) => a.usage === 'few_shot').length,
        questionnaire_complete:
          !!ws.display_name &&
          required.every((q) => (stored[q.id] ?? '').trim().length > 0),
      },
    };
  }

  /**
   * Curation stage for the dashboard home card. Read-only: unlike `view`, it never creates a
   * workspace, so opening the dashboard does not count as having started a persona.
   */
  async status(psychologistId: string) {
    const ws = await this.prisma.ai_persona_workspaces.findUnique({
      where: { psychologist_id: psychologistId },
    });
    const personaId = ws?.persona_id ?? personaIdFor(psychologistId);
    const [questionnaire, fewShots, versions, persona] = await Promise.all([
      this.content.active('persona_questionnaire', 'default'),
      ws
        ? this.prisma.ai_eval_cases.count({
            where: { persona_id: personaId, usage: 'few_shot' },
          })
        : 0,
      this.prisma.ai_content_versions.count({
        where: { kind: 'persona_card', ref_id: personaId },
      }),
      this.prisma.ai_personas.findUnique({ where: { id: personaId } }),
    ]);
    const answers = asAnswers(ws?.answers ?? null);
    const required =
      questionnaire?.body.questions.filter((q) => q.required) ?? [];
    const answered = required.filter(
      (q) => (answers[q.id] ?? '').trim().length > 0,
    ).length;
    return {
      stage: personaStage({
        questionnaireAvailable: !!questionnaire,
        workspace: ws
          ? {
              displayName: ws.display_name,
              answered,
              required: required.length,
            }
          : null,
        fewShotAnswered: fewShots,
        versions,
        persona: persona
          ? { status: persona.status, activeVersion: persona.active_version }
          : null,
      }),
      questionnaire: { answered, required: required.length },
      display_name: ws?.display_name ?? null,
    };
  }

  /** Partial saves are fine; the draft step checks completeness. */
  async saveQuestionnaire(
    psychologistId: string,
    answers: Record<string, string>,
  ) {
    const questionnaire = await this.questionnaire();
    const ids = new Set(questionnaire.body.questions.map((q) => q.id));
    for (const [id, answer] of Object.entries(answers)) {
      if (!ids.has(id))
        throw new BadRequestException(`Pertanyaan ${id} tidak dikenal`);
      if (typeof answer !== 'string' || answer.length > MAX_ANSWER_CHARS)
        throw new BadRequestException(`Jawaban ${id} terlalu panjang`);
    }
    const ws = await this.workspace(psychologistId);
    const merged = { ...asAnswers(ws.answers), ...answers };
    const displayName = merged.approach_name?.trim().slice(0, 120) || null;
    await this.prisma.ai_persona_workspaces.update({
      where: { psychologist_id: psychologistId },
      data: {
        answers: merged,
        questionnaire_version: questionnaire.version,
        display_name: displayName,
      },
    });
    return this.view(psychologistId);
  }

  async saveCase(psychologistId: string, caseRef: string, response: string) {
    const text = response.trim();
    if (text.length === 0 || text.length > MAX_ANSWER_CHARS)
      throw new BadRequestException('Jawaban kosong atau terlalu panjang');
    const item = (await this.content.listActive('case_study')).find(
      (c) => c.refId === caseRef,
    );
    if (!item) throw new NotFoundException('Studi kasus tidak ditemukan');
    const ws = await this.workspace(psychologistId);
    const data = {
      case_version: item.version,
      scenario: item.body.scenario,
      ideal_response: text,
      expected_risk_level: item.body.expected_risk_level,
      usage: item.body.usage,
    };
    await this.prisma.ai_eval_cases.upsert({
      where: {
        persona_id_case_ref: { persona_id: ws.persona_id, case_ref: caseRef },
      },
      create: {
        id: uuidv7(),
        author_psychologist_id: psychologistId,
        persona_id: ws.persona_id,
        case_ref: caseRef,
        ...data,
      },
      update: data,
    });
    return this.view(psychologistId);
  }

  /** Draft Persona Card. Few-shot examples are the psikolog's own words, never rewritten. */
  async draft(psychologistId: string) {
    const ws = await this.workspace(psychologistId);
    const questionnaire = await this.questionnaire();
    const answers = asAnswers(ws.answers);
    const missing = questionnaire.body.questions.filter(
      (q) => q.required && !(answers[q.id] ?? '').trim(),
    );
    if (missing.length > 0 || !ws.display_name) {
      throw new BadRequestException({
        code: 'QUESTIONNAIRE_INCOMPLETE',
        message: 'Lengkapi kuesioner dulu',
        missing: missing.map((q) => q.id),
      });
    }
    const fewShots = await this.prisma.ai_eval_cases.findMany({
      where: { persona_id: ws.persona_id, usage: 'few_shot' },
      orderBy: { case_ref: 'asc' },
      take: MAX_FEW_SHOTS,
    });
    if (fewShots.length === 0) {
      throw new BadRequestException({
        code: 'FEW_SHOTS_REQUIRED',
        message: 'Jawab minimal satu studi kasus contoh dulu',
      });
    }
    const draft = await this.agent.personaDraft({
      display_name: ws.display_name,
      answers: questionnaire.body.questions
        .filter((q) => (answers[q.id] ?? '').trim())
        .map((q) => ({ question: q.prompt, answer: answers[q.id] })),
      few_shots: fewShots.map((c) => ({
        scenario: c.scenario,
        response: c.ideal_response,
      })),
    });
    const topics = topicsFrom(draft.card.focus_topics, answers.focus_topics);
    const parsed = personaCardSchema.safeParse({
      ...draft.card,
      focus_topics: topics,
      few_shots: fewShots.map((c) => ({
        user: c.scenario,
        assistant: c.ideal_response,
      })),
    });
    if (!parsed.success) {
      throw new BadGatewayException({
        code: 'DRAFT_INVALID',
        message: 'Draft dari AI tidak lengkap, coba buat ulang',
      });
    }
    return this.saveVersion(ws, parsed.data, psychologistId);
  }

  /** "Koreksi": the edited card becomes a new draft version. */
  async correct(psychologistId: string, card: unknown) {
    const parsed = personaCardSchema.safeParse(card);
    if (!parsed.success) {
      throw new BadRequestException({
        code: 'CARD_INVALID',
        message: 'Persona Card tidak sesuai format',
        issues: parsed.error.issues.slice(0, 20).map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }
    const ws = await this.workspace(psychologistId);
    return this.saveVersion(ws, parsed.data, psychologistId);
  }

  async approve(psychologistId: string, version: number) {
    const ws = await this.workspace(psychologistId);
    const row = await this.prisma.ai_content_versions.findUnique({
      where: {
        kind_ref_id_version: {
          kind: 'persona_card',
          ref_id: ws.persona_id,
          version,
        },
      },
    });
    if (!row) throw new NotFoundException('Versi persona tidak ditemukan');
    if (row.status !== 'draft' && row.status !== 'in_review')
      throw new ConflictException('Versi ini sudah tidak bisa disetujui');
    const readiness = await this.evals.readiness(ws.persona_id, version);
    if (!readiness.ok) {
      throw new ConflictException({
        code: 'EVAL_REQUIRED',
        message: readiness.reason,
      });
    }
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.ai_content_versions.updateMany({
        where: {
          kind: 'persona_card',
          ref_id: ws.persona_id,
          status: 'approved',
        },
        data: { status: 'retired' },
      });
      await tx.ai_content_versions.update({
        where: { id: row.id },
        data: {
          status: 'approved',
          approved_by: psychologistId,
          approved_at: now,
          reviewed_by: psychologistId,
          reviewed_at: now,
        },
      });
      await tx.ai_personas.update({
        where: { id: ws.persona_id },
        data: {
          active_version: version,
          status: 'active',
          disabled_at: null,
          ...(ws.display_name ? { display_name: ws.display_name } : {}),
        },
      });
    });
    this.content.invalidate();
    return this.view(psychologistId);
  }

  async setEnabled(psychologistId: string, enabled: boolean) {
    const ws = await this.workspace(psychologistId);
    const persona = await this.prisma.ai_personas.findUnique({
      where: { id: ws.persona_id },
    });
    if (!persona) throw new NotFoundException('Persona belum dibuat');
    if (enabled && persona.active_version === null)
      throw new ConflictException('Setujui satu versi persona dulu');
    await this.prisma.ai_personas.update({
      where: { id: ws.persona_id },
      data: enabled
        ? { status: 'active', disabled_at: null }
        : { status: 'disabled', disabled_at: new Date() },
    });
    return this.view(psychologistId);
  }

  private async questionnaire() {
    const questionnaire = await this.content.active(
      'persona_questionnaire',
      'default',
    );
    if (!questionnaire)
      throw new ServiceUnavailableException('Kuesioner persona belum tersedia');
    return questionnaire;
  }

  private async saveVersion(
    ws: ai_persona_workspaces,
    card: PersonaCard,
    authorId: string,
  ) {
    await this.prisma.$transaction(async (tx) => {
      // The persona row exists from the first draft but stays disabled until approved.
      await tx.ai_personas.upsert({
        where: { id: ws.persona_id },
        create: {
          id: ws.persona_id,
          psychologist_id: ws.psychologist_id,
          display_name: ws.display_name ?? ws.persona_id,
          status: 'disabled',
          disabled_at: new Date(),
        },
        update: {},
      });
      const latest = await tx.ai_content_versions.findFirst({
        where: { kind: 'persona_card', ref_id: ws.persona_id },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      await tx.ai_content_versions.create({
        data: {
          id: uuidv7(),
          kind: 'persona_card',
          ref_id: ws.persona_id,
          version: (latest?.version ?? 0) + 1,
          body: card,
          status: 'draft',
          author_id: authorId,
        },
      });
    });
    return this.view(ws.psychologist_id);
  }
}

function asAnswers(value: Prisma.JsonValue): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
}

/** The model's topic IDs when valid; otherwise the psikolog's own comma-separated answer. */
function topicsFrom(
  fromModel: unknown,
  fromAnswer: string | undefined,
): string[] {
  const model = Array.isArray(fromModel)
    ? fromModel.filter(
        (t): t is string => typeof t === 'string' && TOPIC.test(t),
      )
    : [];
  if (model.length > 0) return model.slice(0, 10);
  return (fromAnswer ?? '')
    .split(/[,\n]/)
    .map((t) => t.trim().toLowerCase().replace(/\s+/g, '_'))
    .filter((t) => TOPIC.test(t))
    .slice(0, 10);
}
