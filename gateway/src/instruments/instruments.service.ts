import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { uuidv7 } from 'uuidv7';
import { AssessmentsService } from '../assessments/assessments.service';
import type { Environment } from '../config/env.schema';
import { OnboardingService } from '../consents/onboarding.service';
import type { Instrument } from '../content/content.schemas';
import { type ActiveContent, ContentService } from '../content/content.service';
import { PrismaService } from '../database/prisma.service';
import { MessageCipher } from '../messages/crypto/message-cipher.service';
import { MetricsService } from '../observability/metrics.service';
import { addDays, isTimeZone, localDate } from '../routines/routine-rules';
import {
  type EscalationProtocol,
  SafetyService,
} from '../safety/safety.service';
import {
  type InstrumentResult,
  InvalidAnswersError,
  nextDue,
  scoreInstrument,
} from './scoring';

const MAX_HISTORY_DAYS = 365;

/** What the ciphertext holds: the answers and the result computed at the time. */
interface StoredResult {
  answers: Record<string, number>;
  result: InstrumentResult;
}

type InstrumentLocale = 'id' | 'en';
type InstrumentTranslation = NonNullable<Instrument['translations']>['en'];

export interface InstrumentSummary {
  ref: string;
  version: number;
  purpose: Instrument['purpose'];
  title: string;
  intro: string;
  interval_days: number;
  item_count: number;
  draft: boolean;
  last_local_date: string | null;
  next_due: string | null;
  /** Due today (or never answered). A same-day answer can always be replaced. */
  due: boolean;
  answered_today: boolean;
}

/**
 * Daily check-in, periodic screening, and personality inventory (03 Phase 8). Instruments are
 * clinical content; answers are encrypted health data. The same gates as a chat session apply
 * (age and, outside the configured beta bypass, service consent), and an answer on a safety
 * item always gets the protocol.
 */
@Injectable()
export class InstrumentsService {
  private readonly logger = new Logger(InstrumentsService.name);
  private readonly helpUrl: string;
  private readonly defaultZone: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly content: ContentService,
    private readonly cipher: MessageCipher,
    private readonly safety: SafetyService,
    private readonly onboarding: OnboardingService,
    private readonly assessments: AssessmentsService,
    private readonly metrics: MetricsService,
    config: ConfigService<Environment, true>,
  ) {
    this.helpUrl = config.get('HELP_URL', { infer: true });
    this.defaultZone = config.get('DEFAULT_TIMEZONE', { infer: true });
  }

  async list(
    userId: string,
    timezone: string | undefined,
    now = new Date(),
    locale: InstrumentLocale = 'id',
  ): Promise<InstrumentSummary[]> {
    const zone = this.zone(timezone);
    const instruments = await this.content.listActive('instrument');
    if (instruments.length === 0) return [];
    const last = await this.prisma.ai_instrument_responses.groupBy({
      by: ['instrument_ref'],
      where: { user_id: userId },
      _max: { local_date: true },
    });
    const lastByRef = new Map(
      last.map((row) => [
        row.instrument_ref,
        row._max.local_date?.toISOString().slice(0, 10) ?? null,
      ]),
    );
    const today = localDate(now, zone);
    const order = { checkin: 0, screening: 1, personality: 2 } as const;
    return instruments
      .map((instrument) =>
        this.summary(
          instrument,
          lastByRef.get(instrument.refId) ?? null,
          today,
          locale,
        ),
      )
      .sort(
        (a, b) =>
          order[a.purpose] - order[b.purpose] || a.title.localeCompare(b.title),
      );
  }

  async detail(
    userId: string,
    ref: string,
    timezone: string | undefined,
    now = new Date(),
    locale: InstrumentLocale = 'id',
  ) {
    const instrument = await this.instrument(ref);
    const last = await this.lastDate(userId, ref);
    const body = instrument.body;
    const copy = this.copy(body, locale);
    return {
      ...this.summary(
        instrument,
        last,
        localDate(now, this.zone(timezone)),
        locale,
      ),
      disclaimer: copy.disclaimer,
      // Thresholds, reverse keys, and bands stay server-side; the form only needs the questions.
      items: body.items.map((item) => {
        const localized = copy.items.find(
          (copyItem) => copyItem.id === item.id,
        );
        return {
          id: item.id,
          prompt: localized?.prompt ?? item.prompt,
          short_label: localized?.short_label ?? item.short_label ?? null,
          options: localized?.options ?? item.options ?? copy.options,
        };
      }),
      dimensions: copy.dimensions,
    };
  }

  async submit(
    userId: string,
    ref: string,
    input: {
      answers: Record<string, number>;
      timezone: string | undefined;
      locale?: InstrumentLocale;
    },
    now = new Date(),
  ) {
    const refusal = await this.onboarding.gate(userId);
    if (refusal) throw new ForbiddenException(refusal);
    const instrument = await this.instrument(ref);
    const zone = this.zone(input.timezone);
    let result: InstrumentResult;
    try {
      result = scoreInstrument(instrument.body, input.answers);
    } catch (error) {
      if (error instanceof InvalidAnswersError) {
        throw new BadRequestException({
          message: 'Jawaban tidak lengkap atau tidak valid',
          code: `ANSWERS_${error.code}`,
        });
      }
      throw error;
    }
    const today = localDate(now, zone);
    const last = await this.lastDate(userId, ref);
    const due = nextDue(last, instrument.body.interval_days);
    if (last !== today && due !== null && due > today) {
      throw new ConflictException({
        message: `Bisa diisi lagi mulai ${due}`,
        code: 'INSTRUMENT_NOT_DUE',
      });
    }

    const existing = await this.prisma.ai_instrument_responses.findUnique({
      where: {
        user_id_instrument_ref_local_date: {
          user_id: userId,
          instrument_ref: ref,
          local_date: new Date(`${today}T00:00:00Z`),
        },
      },
      select: { id: true },
    });
    const id = existing?.id ?? uuidv7();
    const stored: StoredResult = { answers: input.answers, result };
    const ciphertext = await this.cipher.encrypt(JSON.stringify(stored), id);
    const data = {
      instrument_version: instrument.version,
      purpose: instrument.body.purpose,
      result_ciphertext: new Uint8Array(ciphertext),
      safety_level: result.safety_level,
    };
    // Same day = a correction of today's answer, not a second entry.
    await this.prisma.ai_instrument_responses.upsert({
      where: { id },
      create: {
        id,
        user_id: userId,
        instrument_ref: ref,
        local_date: new Date(`${today}T00:00:00Z`),
        ...data,
      },
      update: data,
    });

    let protocol: EscalationProtocol | null = null;
    if (result.safety_level !== 'normal') {
      protocol = await this.safety.protocol(result.safety_level);
      await this.safety.record({
        sessionId: null,
        layer: 'instrument',
        level: result.safety_level,
        signals: [`instrument:${ref}`],
      });
      if (result.safety_level === 'crisis') {
        this.metrics.record('crisis_protocol_sent', { path: 'instrument' });
      }
    }
    this.metrics.record('instrument_response', {
      purpose: instrument.body.purpose,
      safety: result.safety_level,
    });

    const topic = instrument.body.topic;
    const assessments =
      result.band?.suggest === 'assessment' && topic
        ? await this.assessments.catalogFor([topic]).catch(() => [])
        : [];
    return {
      id,
      local_date: today,
      next_due: addDays(today, instrument.body.interval_days),
      result: this.view(instrument.body, result, input.locale ?? 'id'),
      protocol: protocol ? { ...protocol, help_url: this.helpUrl } : null,
      assessments,
    };
  }

  async history(
    userId: string,
    ref: string,
    days: number,
    timezone: string | undefined,
    now = new Date(),
    locale: InstrumentLocale = 'id',
  ) {
    const instrument = await this.instrument(ref);
    const copy = this.copy(instrument.body, locale);
    const span = Math.min(Math.max(days, 1), MAX_HISTORY_DAYS);
    const from = addDays(localDate(now, this.zone(timezone)), -(span - 1));
    const rows = await this.prisma.ai_instrument_responses.findMany({
      where: {
        user_id: userId,
        instrument_ref: ref,
        local_date: { gte: new Date(`${from}T00:00:00Z`) },
      },
      orderBy: { local_date: 'asc' },
    });
    const decoded = await Promise.all(
      rows.map(async (row) => {
        let stored: StoredResult;
        try {
          stored = JSON.parse(
            await this.cipher.decrypt(row.result_ciphertext, row.id),
          ) as StoredResult;
        } catch (error) {
          // One unreadable row must not hide the rest of the trend; log the error name only.
          this.logger.error({
            err: { name: error instanceof Error ? error.name : 'unknown' },
            instrument_response: row.id,
          });
          return null;
        }
        return {
          id: row.id,
          local_date: row.local_date.toISOString().slice(0, 10),
          instrument_version: row.instrument_version,
          answers: stored.answers,
          result: this.view(instrument.body, stored.result, locale),
        };
      }),
    );
    const points = decoded.filter((point) => point !== null);
    return {
      ref,
      title: copy.title,
      purpose: instrument.body.purpose,
      from,
      items: instrument.body.items.map((item) => {
        const localized = copy.items.find(
          (copyItem) => copyItem.id === item.id,
        );
        return {
          id: item.id,
          short_label: localized?.short_label ?? item.short_label ?? null,
          options: localized?.options ?? item.options ?? copy.options,
        };
      }),
      points,
    };
  }

  /** The user removes one of their own entries; safety events stay (they hold no answers). */
  async remove(userId: string, id: string): Promise<void> {
    const { count } = await this.prisma.ai_instrument_responses.deleteMany({
      where: { id, user_id: userId },
    });
    if (count === 0) throw new NotFoundException('Data tidak ditemukan');
  }

  /** Every answer of the user; separate from `DELETE /me/history`, like routines. */
  async removeAll(userId: string): Promise<number> {
    const { count } = await this.prisma.ai_instrument_responses.deleteMany({
      where: { user_id: userId },
    });
    return count;
  }

  private view(
    instrument: Instrument,
    result: InstrumentResult,
    locale: InstrumentLocale,
  ) {
    const copy = this.copy(instrument, locale);
    const bandIndex = instrument.scoring.bands.findIndex(
      (band) =>
        result.total.score >= band.min && result.total.score <= band.max,
    );
    const bandTranslation = bandIndex >= 0 ? copy.bands[bandIndex] : undefined;
    return {
      total: result.total,
      band: result.band
        ? {
            ...result.band,
            ...(bandTranslation
              ? {
                  label: bandTranslation.label,
                  description: bandTranslation.description,
                }
              : {}),
          }
        : null,
      dimensions: result.dimensions.map((dimension) => {
        const localized = copy.dimensions.find(
          (item) => item.id === dimension.id,
        );
        return {
          ...dimension,
          ...(localized
            ? {
                label: localized.label,
                description: localized.description,
              }
            : {}),
        };
      }),
      safety_level: result.safety_level,
      disclaimer: copy.disclaimer,
    };
  }

  private summary(
    instrument: ActiveContent<'instrument'>,
    last: string | null,
    today: string,
    locale: InstrumentLocale,
  ): InstrumentSummary {
    const due = nextDue(last, instrument.body.interval_days);
    const copy = this.copy(instrument.body, locale);
    return {
      ref: instrument.refId,
      version: instrument.version,
      purpose: instrument.body.purpose,
      title: copy.title,
      intro: copy.intro,
      interval_days: instrument.body.interval_days,
      item_count: instrument.body.items.length,
      draft: instrument.status !== 'approved',
      last_local_date: last,
      next_due: due,
      due: due === null || due <= today || last === today,
      answered_today: last === today,
    };
  }

  private copy(instrument: Instrument, locale: InstrumentLocale) {
    const translation: InstrumentTranslation | undefined =
      locale === 'en' ? instrument.translations?.en : undefined;
    const items = translation?.items
      ? instrument.items.map((item) => ({
          ...item,
          ...translation.items.find((localized) => localized.id === item.id),
        }))
      : instrument.items;
    return {
      title: translation?.title ?? instrument.title,
      intro: translation?.intro ?? instrument.intro,
      disclaimer: translation?.disclaimer ?? instrument.disclaimer,
      options: translation?.options ?? instrument.options,
      items,
      dimensions:
        translation?.scoring.dimensions ?? instrument.scoring.dimensions,
      bands:
        translation?.scoring.bands ??
        instrument.scoring.bands.map(({ label, description }) => ({
          label,
          description,
        })),
    };
  }

  private async instrument(ref: string): Promise<ActiveContent<'instrument'>> {
    const instrument = await this.content.active('instrument', ref);
    if (!instrument) throw new NotFoundException('Instrumen tidak tersedia');
    return instrument;
  }

  private async lastDate(userId: string, ref: string): Promise<string | null> {
    const last = await this.prisma.ai_instrument_responses.findFirst({
      where: { user_id: userId, instrument_ref: ref },
      orderBy: { local_date: 'desc' },
      select: { local_date: true },
    });
    return last?.local_date.toISOString().slice(0, 10) ?? null;
  }

  private zone(requested: string | undefined): string {
    const timezone = requested ?? this.defaultZone;
    if (!isTimeZone(timezone)) {
      throw new BadRequestException('Zona waktu tidak valid');
    }
    return timezone;
  }
}
