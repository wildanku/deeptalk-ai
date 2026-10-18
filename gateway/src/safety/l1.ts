import type { L1Phrases } from '../content/content.schemas';

/**
 * L1 safety: deterministic, local, no network (02 §7.2). Runs in the gateway before the agent,
 * so a crisis message is caught even when the agent or Vertex AI is down.
 *
 * Text and phrases go through the same normalization, so a phrase written plainly by a
 * psikolog also matches slang and stretched spellings ("pengen matiii", "bundir").
 * A phrase token `...` allows up to three words in between ("ingin ... mati").
 */

export type L1Level = 'normal' | 'elevated' | 'crisis';

export interface L1Result {
  level: L1Level;
  /** Matched phrase IDs (`crisis#3`) — never the user's words. */
  signals: string[];
}

const GAP = '...';
const MAX_GAP_WORDS = 3;

interface CompiledPhrase {
  id: string;
  level: Exclude<L1Level, 'normal'>;
  pattern: RegExp;
}

export interface CompiledL1 {
  phrases: CompiledPhrase[];
  normalization: Map<string, string>;
}

function baseNormalize(text: string): string {
  return (
    text
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      // Common character substitutions in chat ("m4t1", "b*nuh").
      .replace(/4/g, 'a')
      .replace(/1/g, 'i')
      .replace(/3/g, 'e')
      .replace(/0/g, 'o')
      .replace(/[^a-z\s]/g, ' ')
      // Stretched letters: "matiii" → "mati", "pengeeen" → "pengen".
      .replace(/([a-z])\1+/g, '$1')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/**
 * Possessive clitics: "hidupku" → "hidup", "dirinya" → "diri". Applied to text and phrases
 * alike, so an occasional over-strip ("bertemu" → "berte") stays consistent on both sides.
 */
function stripClitic(word: string): string {
  if (word.length < 5) return word;
  return word.replace(/(?:ku|mu|nya)$/, '');
}

export function normalizeText(
  text: string,
  normalization: Map<string, string>,
): string {
  const words = baseNormalize(text).split(' ');
  return words
    .map((word) => normalization.get(word) ?? stripClitic(word))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escape(word: string): string {
  return word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function compilePhrase(
  phrase: string,
  normalization: Map<string, string>,
): RegExp | null {
  const parts = phrase
    .split(GAP)
    .map((part) => normalizeText(part, normalization))
    .filter((part) => part.length > 0);
  if (parts.length === 0) return null;
  const gap = `(?: [a-z]+){0,${MAX_GAP_WORDS}}`;
  const body = parts
    .map((part) => part.split(' ').map(escape).join(' '))
    .join(gap + ' ');
  return new RegExp(`(?:^| )${body}(?: |$)`);
}

export function compileL1(phrases: L1Phrases): CompiledL1 {
  const normalization = new Map(
    Object.entries(phrases.normalization).map(([from, to]) => [
      baseNormalize(from),
      baseNormalize(to),
    ]),
  );
  const compiled: CompiledPhrase[] = [];
  for (const level of ['crisis', 'elevated'] as const) {
    phrases[level].forEach((phrase, index) => {
      const pattern = compilePhrase(phrase, normalization);
      if (pattern) compiled.push({ id: `${level}#${index}`, level, pattern });
    });
  }
  return { phrases: compiled, normalization };
}

export function checkL1(text: string, l1: CompiledL1): L1Result {
  const normalized = normalizeText(text, l1.normalization);
  const signals: string[] = [];
  let level: L1Level = 'normal';
  for (const phrase of l1.phrases) {
    if (phrase.pattern.test(normalized)) {
      signals.push(phrase.id);
      if (phrase.level === 'crisis') level = 'crisis';
      else if (level === 'normal') level = 'elevated';
    }
  }
  return { level, signals };
}
