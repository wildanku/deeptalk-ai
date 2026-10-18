import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { l1PhrasesSchema } from '../content/content.schemas';
import { checkL1, compileL1, normalizeText } from './l1';
import { maxRisk, nextSessionRisk } from './risk';

const CONTENT = join(__dirname, '..', '..', '..', 'content');
const read = (path: string): unknown =>
  JSON.parse(readFileSync(join(CONTENT, path), 'utf8'));

const draft = compileL1(
  l1PhrasesSchema.parse(
    (read('l1-phrases/default.json') as { body: unknown }).body,
  ),
);
const cases = (
  read('evals/safety-cases.draft.json') as {
    cases: {
      id: string;
      text: string;
      expected: 'normal' | 'elevated' | 'crisis';
    }[];
  }
).cases;

describe('L1', () => {
  it('normalizes case, punctuation, digits, stretched letters, and slang', () => {
    const l1 = compileL1({
      crisis: ['x'],
      elevated: [],
      normalization: { pgn: 'ingin' },
    });
    expect(normalizeText('PGN m4tiii!!!', l1.normalization)).toBe('ingin mati');
  });

  it.each(cases.filter((c) => c.expected === 'crisis'))(
    'flags crisis case $id',
    ({ text }) => {
      expect(checkL1(text, draft).level).toBe('crisis');
    },
  );

  it.each(cases.filter((c) => c.expected === 'normal'))(
    'leaves normal case $id alone',
    ({ text }) => {
      expect(checkL1(text, draft)).toEqual({ level: 'normal', signals: [] });
    },
  );

  it.each(cases.filter((c) => c.expected === 'elevated'))(
    'flags elevated case $id',
    ({ text }) => {
      expect(checkL1(text, draft).level).toBe('elevated');
    },
  );

  it('strips possessive clitics', () => {
    const l1 = compileL1({
      crisis: ['akhiri hidup'],
      elevated: [],
      normalization: {},
    });
    expect(checkL1('mau akhiri hidupku', l1).level).toBe('crisis');
  });

  it('matches gaps of up to three words with "..."', () => {
    const l1 = compileL1({
      crisis: ['ingin ... mati'],
      elevated: [],
      normalization: {},
    });
    expect(checkL1('ingin rasanya aku mati', l1).level).toBe('crisis');
    expect(checkL1('ingin satu dua tiga empat mati', l1).level).toBe('normal');
  });

  it('matches whole words only', () => {
    const l1 = compileL1({ crisis: ['mati'], elevated: [], normalization: {} });
    expect(checkL1('matikan lampunya', l1).level).toBe('normal');
  });

  it('reports phrase IDs, never the user text', () => {
    const result = checkL1('aku ingin mati', draft);
    expect(
      result.signals.every((signal) => /^(crisis|elevated)#\d+$/.test(signal)),
    ).toBe(true);
  });
});

describe('session risk', () => {
  it('never lowers crisis', () => {
    expect(
      nextSessionRisk({ level: 'crisis', normalStreak: 0 }, 'normal').level,
    ).toBe('crisis');
  });

  it('returns elevated to normal after three normal turns', () => {
    let risk = nextSessionRisk(
      { level: 'normal', normalStreak: 0 },
      'elevated',
    );
    risk = nextSessionRisk(risk, 'normal');
    risk = nextSessionRisk(risk, 'normal');
    expect(risk.level).toBe('elevated');
    risk = nextSessionRisk(risk, 'normal');
    expect(risk).toEqual({ level: 'normal', normalStreak: 0 });
  });

  it('resets the streak on another elevated turn', () => {
    const risk = nextSessionRisk(
      { level: 'elevated', normalStreak: 2 },
      'elevated',
    );
    expect(risk).toEqual({ level: 'elevated', normalStreak: 0 });
  });

  it('takes the highest level', () => {
    expect(maxRisk('normal', 'crisis', 'elevated')).toBe('crisis');
  });
});
