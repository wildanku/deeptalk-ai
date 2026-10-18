import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { uuidv7 } from 'uuidv7';
import { ContentService } from '../content/content.service';
import { PrismaService } from '../database/prisma.service';
import type { ai_user_routines, Prisma } from '../generated/prisma/client';
import { MessageCipher } from '../messages/crypto/message-cipher.service';
import type { RiskLevel } from '../safety/risk';
import {
  addDays,
  EXCLUDED_ROUTINE_TOPICS,
  isTimeZone,
  localDate,
  MAX_ACTIVE_ROUTINES,
  reminderTimesSchema,
  type RoutineSnapshot,
  routineProposalSchema,
} from './routine-rules';

export type ProposalRejection =
  | 'invalid_shape'
  | 'risk_not_normal'
  | 'excluded_topic'
  | 'unknown_item'
  | 'topic_mismatch'
  | 'duplicate_item'
  | 'too_many_active'
  | 'already_proposed';

export type ProposalResult =
  | { ok: true; proposalId: string; routine: RoutineSnapshot }
  | { ok: false; reason: ProposalRejection };

export interface RoutineTodayView {
  id: string;
  status: string;
  routine: RoutineSnapshot;
  reminder_times: string[];
  timezone: string;
  today: string;
  items: {
    id: string;
    done: boolean;
    value: number | null;
  }[];
  /** Nothing was logged yesterday: show a supportive message, never a reprimand. */
  missed_yesterday: boolean;
  missed_message: string | null;
}

const DEFAULT_MISSED_MESSAGE =
  'Tidak apa-apa melewatkan satu hari. Hari ini kita mulai lagi, sekecil apa pun.';
const MAX_LOG_DAYS_BACK = 2;

/**
 * Daily Routine (Phase 3): proposals built only from the active library, validated here before
 * any card reaches the user (02 §7.4), the user's decision, and day-to-day logging. Running and
 * logging a routine never uses the chat quota (Konsep §3.6).
 */
@Injectable()
export class RoutinesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly content: ContentService,
    private readonly cipher: MessageCipher,
  ) {}

  /** Library items the agent may choose from for these topics. */
  async catalogFor(
    topics: string[],
  ): Promise<
    { id: string; topic: string; title: string; description: string }[]
  > {
    const wanted = new Set(
      topics.filter((topic) => !EXCLUDED_ROUTINE_TOPICS.has(topic)),
    );
    const library = await this.content.listActive('routine_item');
    return library
      .filter((item) => wanted.has(item.body.topic))
      .slice(0, 15)
      .map((item) => ({
        id: item.refId,
        topic: item.body.topic,
        title: item.body.title,
        description: item.body.description,
      }));
  }

  async activeCount(userId: string): Promise<number> {
    return this.prisma.ai_user_routines.count({
      where: { user_id: userId, status: { in: ['active', 'paused'] } },
    });
  }

  async adherence(
    userId: string,
  ): Promise<{ title: string; adherence_7d: number }[]> {
    const routines = await this.prisma.ai_user_routines.findMany({
      where: { user_id: userId, status: 'active' },
    });
    return Promise.all(
      routines.map(async (routine) => ({
        title: (routine.routine as unknown as RoutineSnapshot).title,
        adherence_7d: (await this.weekStats(routine)).adherence,
      })),
    );
  }

  async propose(
    userId: string,
    sessionId: string,
    risk: RiskLevel,
    input: unknown,
    /** The assistant reply the card is shown under. */
    messageId: string | null = null,
  ): Promise<ProposalResult> {
    const parsed = routineProposalSchema.safeParse(input);
    if (!parsed.success) return { ok: false, reason: 'invalid_shape' };
    const proposal = parsed.data;
    // Not during distress: support and human help first (Konsep §3.6, 02 §7.4).
    if (risk !== 'normal') return { ok: false, reason: 'risk_not_normal' };
    if (EXCLUDED_ROUTINE_TOPICS.has(proposal.topic))
      return { ok: false, reason: 'excluded_topic' };
    const ids = proposal.items.map((item) => item.library_item_id);
    if (new Set(ids).size !== ids.length)
      return { ok: false, reason: 'duplicate_item' };

    const library = new Map(
      (await this.content.listActive('routine_item')).map((item) => [
        item.refId,
        item,
      ]),
    );
    const items: RoutineSnapshot['items'] = [];
    for (const id of ids) {
      const item = library.get(id);
      if (!item) return { ok: false, reason: 'unknown_item' };
      if (item.body.topic !== proposal.topic)
        return { ok: false, reason: 'topic_mismatch' };
      items.push({
        id,
        version: item.version,
        title: item.body.title,
        description: item.body.description,
        kind: item.body.kind,
        time_of_day: item.body.time_of_day,
        trigger: item.body.trigger ?? null,
        scale: item.body.scale ?? null,
        missed_day_message: item.body.missed_day_message ?? null,
      });
    }
    if ((await this.activeCount(userId)) >= MAX_ACTIVE_ROUTINES) {
      return { ok: false, reason: 'too_many_active' };
    }
    const already = await this.prisma.ai_routine_proposals.count({
      where: {
        session_id: sessionId,
        status: { in: ['proposed', 'accepted'] },
      },
    });
    if (already > 0) return { ok: false, reason: 'already_proposed' };

    const routine: RoutineSnapshot = {
      topic: proposal.topic,
      title: proposal.title ?? items[0].title,
      personalization_note: proposal.personalization_note ?? null,
      items,
    };
    const proposalId = uuidv7();
    await this.prisma.ai_routine_proposals.create({
      data: {
        id: proposalId,
        session_id: sessionId,
        user_id: userId,
        message_id: messageId,
        routine: routine as unknown as Prisma.InputJsonValue,
      },
    });
    return { ok: true, proposalId, routine };
  }

  /**
   * The user decides (Konsep §6 "Persetujuan pengguna"): accept, accept an edited version
   * (a subset of the proposed items, own reminder times), or reject.
   */
  async decide(
    userId: string,
    proposalId: string,
    decision: 'accept' | 'edit' | 'reject',
    edit?: {
      item_ids?: string[];
      reminder_times?: string[];
      timezone?: string;
    },
  ): Promise<{ routine_id: string | null }> {
    const proposal = await this.prisma.ai_routine_proposals.findFirst({
      where: { id: proposalId, user_id: userId },
    });
    if (!proposal)
      throw new NotFoundException('Usulan routine tidak ditemukan');
    if (proposal.status !== 'proposed')
      throw new ConflictException('Usulan sudah diputuskan');

    if (decision === 'reject') {
      await this.prisma.ai_routine_proposals.update({
        where: { id: proposalId },
        data: { status: 'rejected', decided_at: new Date() },
      });
      return { routine_id: null };
    }

    const routine = proposal.routine as unknown as RoutineSnapshot;
    let items = routine.items;
    if (decision === 'edit' && edit?.item_ids) {
      const keep = new Set(edit.item_ids);
      items = routine.items.filter((item) => keep.has(item.id));
      // An edit can only remove proposed items, never add unvetted ones.
      if (items.length === 0 || items.length !== keep.size) {
        throw new BadRequestException('Pilihan item routine tidak valid');
      }
    }
    const reminders = reminderTimesSchema.safeParse(edit?.reminder_times ?? []);
    if (!reminders.success)
      throw new BadRequestException('Waktu pengingat tidak valid');
    const timezone = edit?.timezone ?? 'Asia/Jakarta';
    if (!isTimeZone(timezone))
      throw new BadRequestException('Zona waktu tidak valid');
    if ((await this.activeCount(userId)) >= MAX_ACTIVE_ROUTINES) {
      throw new ConflictException('Maksimal dua routine aktif');
    }

    const routineId = uuidv7();
    await this.prisma.$transaction([
      this.prisma.ai_routine_proposals.update({
        where: { id: proposalId },
        data: { status: 'accepted', decided_at: new Date() },
      }),
      this.prisma.ai_user_routines.create({
        data: {
          id: routineId,
          user_id: userId,
          source_session_id: proposal.session_id,
          proposal_id: proposalId,
          routine: { ...routine, items },
          reminder_times: reminders.data,
          timezone,
        },
      }),
    ]);
    return { routine_id: routineId };
  }

  async listForUser(
    userId: string,
    now = new Date(),
  ): Promise<RoutineTodayView[]> {
    const routines = await this.prisma.ai_user_routines.findMany({
      where: { user_id: userId, status: { in: ['active', 'paused'] } },
      orderBy: { created_at: 'asc' },
    });
    return Promise.all(routines.map((routine) => this.todayView(routine, now)));
  }

  async log(
    userId: string,
    routineId: string,
    input: {
      item_id: string;
      date: string;
      done: boolean;
      value?: number | null;
      note?: string | null;
    },
    now = new Date(),
  ): Promise<void> {
    const routine = await this.owned(userId, routineId);
    const snapshot = routine.routine as unknown as RoutineSnapshot;
    const item = snapshot.items.find(
      (candidate) => candidate.id === input.item_id,
    );
    if (!item) throw new BadRequestException('Item routine tidak dikenal');
    const today = localDate(now, routine.timezone);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(input.date) ||
      input.date > today ||
      input.date < addDays(today, -MAX_LOG_DAYS_BACK)
    ) {
      throw new BadRequestException(
        `Catatan hanya untuk hari ini atau ${MAX_LOG_DAYS_BACK} hari sebelumnya`,
      );
    }
    if (input.value !== undefined && input.value !== null) {
      if (
        item.kind !== 'scale' ||
        !item.scale ||
        input.value < item.scale.min ||
        input.value > item.scale.max
      ) {
        throw new BadRequestException('Nilai di luar skala');
      }
    }
    const date = new Date(`${input.date}T00:00:00Z`);
    const existing = await this.prisma.ai_routine_logs.findUnique({
      where: {
        user_routine_id_item_id_date: {
          user_routine_id: routineId,
          item_id: item.id,
          date,
        },
      },
    });
    const id = existing?.id ?? uuidv7();
    // Notes may hold personal detail: encrypted like messages, bound to the log row.
    const note =
      input.note && input.note.trim()
        ? new Uint8Array(
            await this.cipher.encrypt(input.note.trim().slice(0, 1000), id),
          )
        : null;
    await this.prisma.ai_routine_logs.upsert({
      where: {
        user_routine_id_item_id_date: {
          user_routine_id: routineId,
          item_id: item.id,
          date,
        },
      },
      create: {
        id,
        user_routine_id: routineId,
        item_id: item.id,
        date,
        done: input.done,
        value: input.value ?? null,
        note_ciphertext: note,
      },
      update: {
        done: input.done,
        value: input.value ?? null,
        note_ciphertext: note,
      },
    });
  }

  async history(userId: string, routineId: string, days = 14) {
    const routine = await this.owned(userId, routineId);
    const today = localDate(new Date(), routine.timezone);
    const from = new Date(
      `${addDays(today, -(Math.min(days, 60) - 1))}T00:00:00Z`,
    );
    const logs = await this.prisma.ai_routine_logs.findMany({
      where: { user_routine_id: routineId, date: { gte: from } },
      orderBy: [{ date: 'asc' }, { item_id: 'asc' }],
    });
    return Promise.all(
      logs.map(async (log) => ({
        item_id: log.item_id,
        date: log.date.toISOString().slice(0, 10),
        done: log.done,
        value: log.value,
        note: log.note_ciphertext
          ? await this.cipher.decrypt(log.note_ciphertext, log.id)
          : null,
      })),
    );
  }

  /** Weekly pattern (Konsep §3.6): per-item completion and an offer to adjust when too heavy. */
  async summary(userId: string, routineId: string) {
    const routine = await this.owned(userId, routineId);
    const stats = await this.weekStats(routine);
    return {
      routine_id: routineId,
      ...stats,
      // Too heavy → offer to make it smaller rather than push harder ("lembut, bukan menghukum").
      suggest_adjustment: stats.adherence < 0.5,
    };
  }

  async update(
    userId: string,
    routineId: string,
    input: {
      status?: 'active' | 'paused' | 'stopped';
      reminder_times?: string[];
    },
  ): Promise<void> {
    await this.owned(userId, routineId);
    const reminders =
      input.reminder_times === undefined
        ? undefined
        : reminderTimesSchema.safeParse(input.reminder_times);
    if (reminders && !reminders.success)
      throw new BadRequestException('Waktu pengingat tidak valid');
    await this.prisma.ai_user_routines.update({
      where: { id: routineId },
      data: {
        ...(input.status ? { status: input.status } : {}),
        ...(input.status === 'stopped' ? { stopped_at: new Date() } : {}),
        ...(reminders?.success ? { reminder_times: reminders.data } : {}),
      },
    });
  }

  private async owned(
    userId: string,
    routineId: string,
  ): Promise<ai_user_routines> {
    const routine = await this.prisma.ai_user_routines.findFirst({
      where: { id: routineId, user_id: userId },
    });
    if (!routine) throw new NotFoundException('Routine tidak ditemukan');
    return routine;
  }

  private async todayView(
    routine: ai_user_routines,
    now: Date,
  ): Promise<RoutineTodayView> {
    const snapshot = routine.routine as unknown as RoutineSnapshot;
    const today = localDate(now, routine.timezone);
    const yesterday = addDays(today, -1);
    const logs = await this.prisma.ai_routine_logs.findMany({
      where: {
        user_routine_id: routine.id,
        date: {
          in: [
            new Date(`${today}T00:00:00Z`),
            new Date(`${yesterday}T00:00:00Z`),
          ],
        },
      },
    });
    const todayLogs = logs.filter(
      (log) => log.date.toISOString().slice(0, 10) === today,
    );
    const startedBeforeYesterday =
      localDate(routine.started_at, routine.timezone) < today;
    const missedYesterday =
      startedBeforeYesterday &&
      !logs.some(
        (log) => log.date.toISOString().slice(0, 10) === yesterday && log.done,
      );
    return {
      id: routine.id,
      status: routine.status,
      routine: snapshot,
      reminder_times: routine.reminder_times,
      timezone: routine.timezone,
      today,
      items: snapshot.items.map((item) => {
        const log = todayLogs.find((entry) => entry.item_id === item.id);
        return {
          id: item.id,
          done: log?.done ?? false,
          value: log?.value ?? null,
        };
      }),
      missed_yesterday: missedYesterday,
      missed_message: missedYesterday
        ? (snapshot.items.find((item) => item.missed_day_message)
            ?.missed_day_message ?? DEFAULT_MISSED_MESSAGE)
        : null,
    };
  }

  private async weekStats(routine: ai_user_routines) {
    const snapshot = routine.routine as unknown as RoutineSnapshot;
    const today = localDate(new Date(), routine.timezone);
    const start = localDate(routine.started_at, routine.timezone);
    const from = addDays(today, -6) > start ? addDays(today, -6) : start;
    const days = Math.max(
      1,
      Math.round(
        (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
          86_400_000,
      ) + 1,
    );
    const logs = await this.prisma.ai_routine_logs.findMany({
      where: {
        user_routine_id: routine.id,
        date: { gte: new Date(`${from}T00:00:00Z`) },
      },
    });
    const items = snapshot.items.map((item) => {
      const itemLogs = logs.filter((log) => log.item_id === item.id);
      const values = itemLogs
        .map((log) => log.value)
        .filter((v): v is number => v !== null);
      return {
        id: item.id,
        title: item.title,
        done_days: itemLogs.filter((log) => log.done).length,
        average_value: values.length
          ? values.reduce((a, b) => a + b, 0) / values.length
          : null,
      };
    });
    const possible = days * snapshot.items.length;
    const done = items.reduce((sum, item) => sum + item.done_days, 0);
    return {
      from,
      to: today,
      days,
      items,
      adherence: possible ? done / possible : 0,
    };
  }
}
