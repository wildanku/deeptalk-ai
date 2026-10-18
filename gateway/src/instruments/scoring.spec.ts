import { instrumentSchema, type Instrument } from '../content/content.schemas';
import { InvalidAnswersError, nextDue, scoreInstrument } from './scoring';

const scale = [0, 1, 2, 3].map((value) => ({ value, label: `opsi ${value}` }));

function instrument(overrides: Partial<Instrument> = {}): Instrument {
  return instrumentSchema.parse({
    purpose: 'screening',
    title: 'Uji',
    intro: 'Pengantar',
    disclaimer: 'Bukan diagnosis',
    interval_days: 14,
    options: scale,
    items: [
      { id: 'a', prompt: 'A' },
      { id: 'b', prompt: 'B', reverse: true },
      { id: 'c', prompt: 'C', safety: { min_value: 1, level: 'crisis' } },
    ],
    scoring: {
      method: 'sum',
      bands: [
        { min: 0, max: 3, label: 'Rendah', description: 'r' },
        {
          min: 4,
          max: 9,
          label: 'Tinggi',
          description: 't',
          suggest: 'psikolog',
        },
      ],
    },
    ...overrides,
  });
}

describe('scoreInstrument', () => {
  it('sums answers, reverses reverse-keyed items, and picks the band', () => {
    const result = scoreInstrument(instrument(), { a: 2, b: 0, c: 0 });
    expect(result.total).toEqual({ score: 5, min: 0, max: 9 });
    expect(result.band).toEqual({
      label: 'Tinggi',
      description: 't',
      suggest: 'psikolog',
    });
    expect(result.safety_level).toBe('normal');
  });

  it('raises the safety level from a safety item regardless of the total', () => {
    const result = scoreInstrument(instrument(), { a: 0, b: 3, c: 1 });
    expect(result.total.score).toBe(1);
    expect(result.band?.label).toBe('Rendah');
    expect(result.safety_level).toBe('crisis');
  });

  it('keeps crisis above elevated', () => {
    const result = scoreInstrument(
      instrument({
        items: [
          {
            id: 'a',
            prompt: 'A',
            reverse: false,
            safety: { min_value: 2, level: 'elevated' },
          },
          {
            id: 'c',
            prompt: 'C',
            reverse: false,
            safety: { min_value: 1, level: 'crisis' },
          },
        ],
      }),
      { a: 3, c: 3 },
    );
    expect(result.safety_level).toBe('crisis');
  });

  it('scores dimensions by mean', () => {
    const inventory = instrument({
      purpose: 'personality',
      items: [
        { id: 'x1', prompt: 'X1', dimension: 'x', reverse: false },
        { id: 'x2', prompt: 'X2', dimension: 'x', reverse: true },
        { id: 'y1', prompt: 'Y1', dimension: 'y', reverse: false },
      ],
      scoring: {
        method: 'mean',
        bands: [],
        dimensions: [
          { id: 'x', label: 'X', description: 'x' },
          { id: 'y', label: 'Y', description: 'y' },
        ],
      },
    });
    const result = scoreInstrument(inventory, { x1: 3, x2: 0, y1: 1 });
    expect(result.dimensions.map((d) => [d.id, d.score, d.min, d.max])).toEqual(
      [
        ['x', 3, 0, 3],
        ['y', 1, 0, 3],
      ],
    );
    expect(result.band).toBeNull();
  });

  it.each([
    [{ a: 1, b: 1 }, 'MISSING'],
    [{ a: 1, b: 1, c: 1, d: 1 }, 'UNKNOWN_ITEM'],
    [{ a: 7, b: 1, c: 1 }, 'INVALID_VALUE'],
  ])('rejects %j', (answers, code) => {
    expect(() => scoreInstrument(instrument(), answers)).toThrow(
      expect.objectContaining({ code }) as InvalidAnswersError,
    );
  });
});

describe('instrumentSchema', () => {
  it('requires every item to name a dimension when dimensions exist', () => {
    const parsed = instrumentSchema.safeParse({
      ...instrument(),
      scoring: {
        method: 'mean',
        dimensions: [{ id: 'x', label: 'X', description: 'x' }],
      },
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects duplicate item ids', () => {
    const parsed = instrumentSchema.safeParse({
      ...instrument(),
      items: [
        { id: 'a', prompt: 'A' },
        { id: 'a', prompt: 'B' },
      ],
    });
    expect(parsed.success).toBe(false);
  });
});

describe('nextDue', () => {
  it('adds the interval to the last local date', () => {
    expect(nextDue('2026-10-14', 14)).toBe('2026-10-28');
    expect(nextDue(null, 1)).toBeNull();
  });
});
