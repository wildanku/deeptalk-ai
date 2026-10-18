import type { Instrument } from '../content/content.schemas';
import type { RiskLevel } from '../safety/risk';

export interface ScoreRange {
  score: number;
  min: number;
  max: number;
}

export interface InstrumentResult {
  total: ScoreRange;
  band: {
    label: string;
    description: string;
    suggest: 'none' | 'assessment' | 'psikolog';
  } | null;
  dimensions: (ScoreRange & {
    id: string;
    label: string;
    description: string;
  })[];
  safety_level: RiskLevel;
}

export class InvalidAnswersError extends Error {
  constructor(readonly code: 'MISSING' | 'UNKNOWN_ITEM' | 'INVALID_VALUE') {
    super(code);
  }
}

type Item = Instrument['items'][number];

const round = (value: number) => Math.round(value * 100) / 100;

function bounds(instrument: Instrument, item: Item) {
  const values = (item.options ?? instrument.options).map((o) => o.value);
  return { min: Math.min(...values), max: Math.max(...values), values };
}

/** `answers[item.id]` must answer every item with one of its option values, and nothing else. */
export function validateAnswers(
  instrument: Instrument,
  answers: Record<string, number>,
): void {
  const ids = new Set(instrument.items.map((item) => item.id));
  for (const key of Object.keys(answers)) {
    if (!ids.has(key)) throw new InvalidAnswersError('UNKNOWN_ITEM');
  }
  for (const item of instrument.items) {
    const value = answers[item.id];
    if (value === undefined) throw new InvalidAnswersError('MISSING');
    if (!bounds(instrument, item).values.includes(value)) {
      throw new InvalidAnswersError('INVALID_VALUE');
    }
  }
}

function aggregate(
  instrument: Instrument,
  items: Item[],
  answers: Record<string, number>,
): ScoreRange {
  let score = 0;
  let min = 0;
  let max = 0;
  for (const item of items) {
    const range = bounds(instrument, item);
    const value = answers[item.id];
    // Reverse-keyed items count from the other end of their own scale.
    score += item.reverse ? range.min + range.max - value : value;
    min += range.min;
    max += range.max;
  }
  if (instrument.scoring.method === 'mean' && items.length > 0) {
    const n = items.length;
    return {
      score: round(score / n),
      min: round(min / n),
      max: round(max / n),
    };
  }
  return { score, min, max };
}

/**
 * Scores validated answers. The safety level comes only from safety items: a low total never
 * hides an answer that needs the protocol.
 */
export function scoreInstrument(
  instrument: Instrument,
  answers: Record<string, number>,
): InstrumentResult {
  validateAnswers(instrument, answers);
  const total = aggregate(instrument, instrument.items, answers);
  const band =
    instrument.scoring.bands.find(
      (b) => total.score >= b.min && total.score <= b.max,
    ) ?? null;
  const dimensions = instrument.scoring.dimensions.map((dimension) => ({
    id: dimension.id,
    label: dimension.label,
    description: dimension.description,
    ...aggregate(
      instrument,
      instrument.items.filter((item) => item.dimension === dimension.id),
      answers,
    ),
  }));
  let safety_level: RiskLevel = 'normal';
  for (const item of instrument.items) {
    if (!item.safety || answers[item.id] < item.safety.min_value) continue;
    if (item.safety.level === 'crisis') safety_level = 'crisis';
    else if (safety_level === 'normal') safety_level = 'elevated';
  }
  return {
    total,
    band: band
      ? {
          label: band.label,
          description: band.description,
          suggest: band.suggest,
        }
      : null,
    dimensions,
    safety_level,
  };
}

/** Next local date the instrument is due, from the last answered local date. */
export function nextDue(
  lastLocalDate: string | null,
  intervalDays: number,
): string | null {
  if (!lastLocalDate) return null;
  const date = new Date(`${lastLocalDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + intervalDays);
  return date.toISOString().slice(0, 10);
}
