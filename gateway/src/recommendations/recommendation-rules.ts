import { z } from 'zod';
import type { ActivePersona } from '../content/content.service';
import type { V3DirectoryEntry } from '../v3-client/v3-client.service';

/** Candidates sent to the agent per turn; the full directory (hundreds) would bloat every prompt. */
export const RECOMMENDATION_MAX_CANDIDATES = 15;
export const RECOMMENDATION_MAX_ITEMS = 3;
const APPROACH_MAX_CHARS = 240;

/** A directory psikolog, enriched with their active Teman AI persona when they have one. */
export interface RecommendationCandidate {
  id: string;
  name: string;
  avatar: string | null;
  specialists: string[];
  year_experience: number | null;
  rating: { rate: number; total: number } | null;
  price_from: number | null;
  persona: {
    label: string;
    approach: string;
    focus_topics: string[];
  } | null;
}

/** Rating weighted by review count, so 5.0 from one review does not beat 4.9 from forty. */
function score(entry: V3DirectoryEntry): number {
  return entry.rating ? entry.rating.rate * Math.log1p(entry.rating.total) : 0;
}

function shorten(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

function withPersona(
  entry: V3DirectoryEntry,
  persona: ActivePersona | undefined,
): RecommendationCandidate {
  return {
    id: entry.id,
    name: entry.name,
    avatar: entry.avatar,
    specialists: entry.specialists,
    year_experience: entry.year_experience,
    rating: entry.rating,
    price_from: entry.price_from,
    persona: persona
      ? {
          label: persona.displayName,
          approach: shorten(persona.card.approach, APPROACH_MAX_CHARS),
          focus_topics: persona.card.focus_topics,
        }
      : null,
  };
}

/**
 * Shortlist for one turn, most relevant first:
 *  1. psikolog whose approved persona focuses on this session's topics (most overlap first);
 *  2. other psikolog with an active persona — their style is known, so the match is better
 *     grounded than a specialist label;
 *  3. everyone else, taking the best rated psikolog of each specialist in turn, so every
 *     specialist (Karir, Pasangan, Anak dan Remaja, …) stays available to the agent.
 * Matching the user's story to a psikolog is the agent's job; this only bounds the list.
 */
export function rankCandidates(
  directory: readonly V3DirectoryEntry[],
  personas: readonly ActivePersona[],
  topics: readonly string[],
  max = RECOMMENDATION_MAX_CANDIDATES,
): RecommendationCandidate[] {
  const personaOf = new Map<string, ActivePersona>();
  for (const persona of personas) {
    if (!personaOf.has(persona.psychologistId))
      personaOf.set(persona.psychologistId, persona);
  }
  const wanted = new Set(topics);
  const overlap = (entry: V3DirectoryEntry) =>
    (personaOf.get(entry.id)?.card.focus_topics ?? []).filter((t) =>
      wanted.has(t),
    ).length;
  const byScore = (a: V3DirectoryEntry, b: V3DirectoryEntry) =>
    score(b) - score(a) || a.id.localeCompare(b.id);

  const withPersonas = directory
    .filter((entry) => personaOf.has(entry.id))
    .sort((a, b) => overlap(b) - overlap(a) || byScore(a, b));
  const chosen = new Map<string, V3DirectoryEntry>();
  for (const entry of withPersonas) {
    if (chosen.size >= max) break;
    chosen.set(entry.id, entry);
  }

  const queues = new Map<string, V3DirectoryEntry[]>();
  for (const entry of [...directory].sort(byScore)) {
    if (chosen.has(entry.id)) continue;
    for (const specialist of entry.specialists) {
      queues.set(specialist, [...(queues.get(specialist) ?? []), entry]);
    }
  }
  const specialists = [...queues.keys()].sort();
  while (chosen.size < max) {
    let added = false;
    for (const specialist of specialists) {
      if (chosen.size >= max) break;
      const next = (queues.get(specialist) ?? []).find(
        (entry) => !chosen.has(entry.id),
      );
      if (next) {
        chosen.set(next.id, next);
        added = true;
      }
    }
    if (!added) break;
  }

  return [...chosen.values()].map((entry) =>
    withPersona(entry, personaOf.get(entry.id)),
  );
}

const proposalSchema = z.object({
  reason: z.string().trim().min(1).max(300),
  items: z
    .array(
      z.object({
        psikolog_id: z.string().min(1).max(255),
        reason: z.string().trim().min(1).max(300),
      }),
    )
    .min(1)
    .max(RECOMMENDATION_MAX_ITEMS),
});

export interface RecommendationProposal {
  reason: string;
  items: { candidate: RecommendationCandidate; reason: string }[];
}

/**
 * The agent's proposal, kept only for psikolog in the current directory (02 §7.4). Unknown or
 * repeated IDs are dropped; nothing left means no card.
 */
export function validateProposal(
  input: unknown,
  candidates: readonly RecommendationCandidate[],
): RecommendationProposal | null {
  const parsed = proposalSchema.safeParse(input);
  if (!parsed.success) return null;
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const seen = new Set<string>();
  const items: RecommendationProposal['items'] = [];
  for (const item of parsed.data.items) {
    const candidate = byId.get(item.psikolog_id);
    if (!candidate || seen.has(candidate.id)) continue;
    seen.add(candidate.id);
    items.push({ candidate, reason: item.reason });
  }
  return items.length ? { reason: parsed.data.reason, items } : null;
}
