import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { uuidv7 } from 'uuidv7';
import { z } from 'zod';
import type { Environment } from '../config/env.schema';
import { ConsentsService } from '../consents/consents.service';
import { PrismaService } from '../database/prisma.service';
import type {
  AiDataGate,
  AiDatasetItemStatus,
  AiDatasetPurpose,
  Prisma,
} from '../generated/prisma/client';
import { MessageCipher } from '../messages/crypto/message-cipher.service';
import { type Deidentifier, mergeFindings } from './deid';
import { assertOpen, BASE_GATES, gateStates, type GateState } from './gates';
import { PsikologDataConsentService } from './psikolog-data-consent.service';
import { withdrawItems } from './withdraw';

export const DEIDENTIFIER = Symbol('DEIDENTIFIER');

export interface Transcript {
  turns: { role: 'user' | 'assistant' | 'psikolog'; text: string }[];
}

/** One conversation from the legacy extraction file (JSONL). Produced outside this repo. */
export const legacyRecordSchema = z.object({
  conversation_id: z.string().min(1).max(255),
  user_id: z.string().min(1).max(255),
  psychologist_id: z.string().min(1).max(255),
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'psikolog']),
        text: z.string().min(1).max(4000),
      }),
    )
    .min(1)
    .max(500),
});
export type LegacyRecord = z.infer<typeof legacyRecordSchema>;

export interface ExportedItem {
  id: string;
  source: 'teman_ai' | 'legacy';
  persona_id: string | null;
  turns: Transcript['turns'];
}

const PAGE = 50;

/**
 * Training-data candidates (03 Phase 9, Konsep §7.4). Every job checks the switch and the
 * approval gates first, every item is de-identified before it is stored, reviewed by a person
 * before it can be used, and re-checked against consent at export time. Logs carry counts
 * only.
 */
@Injectable()
export class DatasetsService {
  private readonly logger = new Logger(DatasetsService.name);
  private readonly enabled: boolean;
  private readonly minFineTuning: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: MessageCipher,
    private readonly consents: ConsentsService,
    private readonly psikologs: PsikologDataConsentService,
    @Inject(DEIDENTIFIER) private readonly deid: Deidentifier,
    config: ConfigService<Environment, true>,
  ) {
    this.enabled = config.get('DATASET_ENABLED', { infer: true });
    this.minFineTuning = config.get('DATASET_MIN_FINE_TUNING_ITEMS', {
      infer: true,
    });
  }

  async gates(): Promise<GateState[]> {
    return gateStates(await this.prisma.ai_data_gates.findMany());
  }

  private async open(required: readonly AiDataGate[]): Promise<void> {
    assertOpen(this.enabled, await this.gates(), required);
  }

  /**
   * Ended Teman AI sessions whose user has training consent now, never excluded from
   * training, and that never reached `crisis` (Konsep §7.2).
   */
  async collectTemanAi(limit = 200) {
    await this.open(BASE_GATES);
    // Sessions not collected yet; the cast keeps the enum comparison on the database side.
    const sessions = await this.prisma.$queryRaw<
      { id: string; user_id: string; persona_id: string | null }[]
    >`
      SELECT s.id, s.user_id, s.persona_id FROM ai_sessions s
      WHERE s.status = 'ended' AND s.exclude_from_training = false
        AND s.max_risk_level <> 'crisis'::"AiRiskLevel"
        AND NOT EXISTS (
          SELECT 1 FROM ai_dataset_items d
          WHERE d.source = 'teman_ai'::"AiDatasetSource" AND d.source_ref = s.id::text)
      ORDER BY s.ended_at ASC
      LIMIT ${limit}`;
    const counts = { collected: 0, no_consent: 0, empty: 0 };
    for (const session of sessions) {
      if (!(await this.consents.trainingActive(session.user_id))) {
        counts.no_consent += 1;
        continue;
      }
      const messages = await this.prisma.ai_messages.findMany({
        where: { session_id: session.id, role: { in: ['user', 'assistant'] } },
        orderBy: { created_at: 'asc' },
      });
      if (messages.length === 0) {
        counts.empty += 1;
        continue;
      }
      const turns: Transcript['turns'] = [];
      for (const message of messages) {
        turns.push({
          role: message.role === 'user' ? 'user' : 'assistant',
          text: await this.cipher.decrypt(
            message.content_ciphertext,
            message.id,
          ),
        });
      }
      const persona = session.persona_id
        ? await this.prisma.ai_personas.findUnique({
            where: { id: session.persona_id },
            select: { psychologist_id: true },
          })
        : null;
      await this.store({
        source: 'teman_ai',
        sourceRef: session.id,
        userId: session.user_id,
        psychologistId: persona?.psychologist_id ?? null,
        personaId: session.persona_id,
        turns,
      });
      counts.collected += 1;
    }
    this.logger.log({ dataset_collect: counts });
    return counts;
  }

  /**
   * Earlier counseling chats from an extraction file (Konsep §7.4 steps 1–3). Only users who
   * agreed to `legacy_counseling` and psikolog whose addendum allows at least one use; silence
   * never counts as agreement.
   */
  async importLegacy(records: unknown[]) {
    await this.open(BASE_GATES);
    const counts = {
      imported: 0,
      invalid: 0,
      no_user_consent: 0,
      no_psikolog_consent: 0,
      already: 0,
    };
    for (const raw of records) {
      const parsed = legacyRecordSchema.safeParse(raw);
      if (!parsed.success) {
        counts.invalid += 1;
        continue;
      }
      const record = parsed.data;
      const exists = await this.prisma.ai_dataset_items.findUnique({
        where: {
          source_source_ref: {
            source: 'legacy',
            source_ref: record.conversation_id,
          },
        },
        select: { id: true },
      });
      if (exists) {
        counts.already += 1;
        continue;
      }
      if (
        !(await this.consents.state(record.user_id, 'legacy_counseling'))
          .granted
      ) {
        counts.no_user_consent += 1;
        continue;
      }
      if (!(await this.psikologs.allowsAny(record.psychologist_id))) {
        counts.no_psikolog_consent += 1;
        continue;
      }
      await this.store({
        source: 'legacy',
        sourceRef: record.conversation_id,
        userId: record.user_id,
        psychologistId: record.psychologist_id,
        personaId: null,
        turns: record.messages.map((m) => ({ role: m.role, text: m.text })),
      });
      counts.imported += 1;
    }
    this.logger.log({ dataset_import_legacy: counts });
    return counts;
  }

  private async store(input: {
    source: 'teman_ai' | 'legacy';
    sourceRef: string;
    userId: string;
    psychologistId: string | null;
    personaId: string | null;
    turns: Transcript['turns'];
  }): Promise<void> {
    const findings: Record<string, number> = {};
    const turns: Transcript['turns'] = [];
    for (const turn of input.turns) {
      const result = await this.deid.deidentify(turn.text);
      mergeFindings(findings, result.findings);
      turns.push({ role: turn.role, text: result.text });
    }
    const id = uuidv7();
    const transcript: Transcript = { turns };
    await this.prisma.ai_dataset_items.create({
      data: {
        id,
        source: input.source,
        source_ref: input.sourceRef,
        user_id: input.userId,
        psychologist_id: input.psychologistId,
        persona_id: input.personaId,
        turns: turns.length,
        content_ciphertext: new Uint8Array(
          await this.cipher.encrypt(JSON.stringify(transcript), id),
        ),
        deid_provider: this.deid.name,
        deid_findings: findings,
      },
    });
  }

  // --- Review (role `data_reviewer`) -----------------------------------------------------

  async summary() {
    const [byStatus, gates] = await Promise.all([
      this.prisma.ai_dataset_items.groupBy({
        by: ['source', 'status'],
        _count: { _all: true },
      }),
      this.gates(),
    ]);
    return {
      enabled: this.enabled,
      deid_provider: this.deid.name,
      gates,
      items: byStatus.map((row) => ({
        source: row.source,
        status: row.status,
        count: row._count._all,
      })),
      exports: await this.prisma.ai_dataset_exports.findMany({
        orderBy: { created_at: 'desc' },
        take: 20,
        select: {
          id: true,
          purpose: true,
          item_count: true,
          exported_by: true,
          created_at: true,
        },
      }),
    };
  }

  async list(status: AiDatasetItemStatus, before?: string) {
    const rows = await this.prisma.ai_dataset_items.findMany({
      where: {
        status,
        ...(before ? { created_at: { lt: new Date(before) } } : {}),
      },
      orderBy: { created_at: 'desc' },
      take: PAGE,
      select: {
        id: true,
        source: true,
        persona_id: true,
        turns: true,
        deid_provider: true,
        deid_findings: true,
        status: true,
        reviewed_by: true,
        reviewed_at: true,
        used_for: true,
        created_at: true,
      },
    });
    return {
      items: rows,
      next_before:
        rows.length === PAGE
          ? rows[rows.length - 1].created_at.toISOString()
          : null,
    };
  }

  /** De-identified text only; the reviewer never sees who the user is. */
  async detail(id: string) {
    const row = await this.prisma.ai_dataset_items.findUnique({
      where: { id },
    });
    if (!row) throw new NotFoundException('Item tidak ditemukan');
    const transcript = row.content_ciphertext
      ? (JSON.parse(
          await this.cipher.decrypt(row.content_ciphertext, row.id),
        ) as Transcript)
      : null;
    return {
      id: row.id,
      source: row.source,
      persona_id: row.persona_id,
      status: row.status,
      deid_provider: row.deid_provider,
      deid_findings: row.deid_findings,
      review_notes: row.review_notes,
      reviewed_by: row.reviewed_by,
      used_for: row.used_for,
      turns: transcript?.turns ?? [],
    };
  }

  async review(
    id: string,
    reviewer: string,
    decision: 'approved' | 'rejected',
    notes: string,
  ) {
    const { count } = await this.prisma.ai_dataset_items.updateMany({
      where: { id, status: { in: ['pending_review', 'approved', 'rejected'] } },
      data: {
        status: decision,
        reviewed_by: reviewer,
        reviewed_at: new Date(),
        review_notes: notes,
      },
    });
    if (count === 0) throw new NotFoundException('Item tidak ditemukan');
    return { id, status: decision };
  }

  // --- Export (staged use: evaluation → style examples → fine-tuning) ----------------------

  /**
   * Approved items for one purpose, re-checked against consent now. Items whose user withdrew
   * are withdrawn on the spot; items whose psikolog refuses this use are skipped. Fine-tuning
   * also needs the `fine_tuning_go` gate and enough reviewed items.
   */
  async export(purpose: AiDatasetPurpose, exportedBy: string) {
    await this.open(
      purpose === 'fine_tuning'
        ? [...BASE_GATES, 'fine_tuning_go']
        : BASE_GATES,
    );
    const rows = await this.prisma.ai_dataset_items.findMany({
      where: { status: 'approved', content_ciphertext: { not: null } },
      orderBy: { created_at: 'asc' },
    });
    const skipped = { user_withdrawn: 0, psikolog_refused: 0 };
    const chosen: typeof rows = [];
    const withdraw: string[] = [];
    for (const row of rows) {
      const consent =
        row.source === 'teman_ai'
          ? await this.consents.trainingActive(row.user_id)
          : (await this.consents.state(row.user_id, 'legacy_counseling'))
              .granted;
      if (!consent) {
        withdraw.push(row.id);
        skipped.user_withdrawn += 1;
        continue;
      }
      // Legacy responses are the psikolog's own words: every use needs their permission.
      // Teman AI replies follow a persona: style examples and training need its psikolog.
      const needsPsikolog = row.source === 'legacy' || purpose !== 'evaluation';
      if (
        needsPsikolog &&
        (!row.psychologist_id ||
          !(await this.psikologs.allows(row.psychologist_id, purpose)))
      ) {
        skipped.psikolog_refused += 1;
        continue;
      }
      chosen.push(row);
    }
    if (withdraw.length > 0) {
      await this.prisma.$transaction((tx) =>
        withdrawItems(tx, { id: { in: withdraw } }),
      );
    }
    if (purpose === 'fine_tuning' && chosen.length < this.minFineTuning) {
      throw new BadRequestException({
        code: 'DATASET_TOO_SMALL',
        message: `Fine-tuning butuh minimal ${this.minFineTuning} item; tersedia ${chosen.length}`,
      });
    }

    const items: ExportedItem[] = [];
    for (const row of chosen) {
      const transcript = JSON.parse(
        await this.cipher.decrypt(row.content_ciphertext as Uint8Array, row.id),
      ) as Transcript;
      items.push({
        id: row.id,
        source: row.source,
        persona_id: row.persona_id,
        turns: transcript.turns,
      });
    }
    const now = new Date();
    const manifest = {
      purpose,
      items: items.length,
      by_source: {
        teman_ai: items.filter((i) => i.source === 'teman_ai').length,
        legacy: items.filter((i) => i.source === 'legacy').length,
      },
      skipped,
    } satisfies Prisma.InputJsonObject;
    await this.prisma.$transaction(async (tx) => {
      await tx.ai_dataset_exports.create({
        data: {
          id: uuidv7(),
          purpose,
          item_count: items.length,
          exported_by: exportedBy,
          manifest,
        },
      });
      for (const row of chosen) {
        await tx.ai_dataset_items.update({
          where: { id: row.id },
          data: {
            last_exported_at: now,
            used_for: row.used_for.includes(purpose)
              ? row.used_for
              : [...row.used_for, purpose],
          },
        });
      }
    });
    this.logger.log({ dataset_export: manifest });
    return { manifest, items };
  }
}
