import { Injectable } from '@nestjs/common';
import type { ActivePersona } from '../content/content.service';
import { PrismaService } from '../database/prisma.service';

const DAY_MS = 86_400_000;
const USAGE_CACHE_MS = 60_000;

/**
 * At most this many personas go to the router. With every psikolog having a persona (03 Phase
 * 8) the full list would make every Quick Chat prompt grow with the team.
 */
export const ROUTER_MAX_CANDIDATES = 12;

/**
 * Candidates for the Quick Chat router: least-used first (sessions in the last 7 days), so new
 * work spreads across psikolog instead of always landing on the first name. When there are more
 * than `max`, every focus topic keeps its least-used personas in turn, so no topic disappears.
 */
export function routerCandidates(
  personas: ActivePersona[],
  usage: ReadonlyMap<string, number>,
  max = ROUTER_MAX_CANDIDATES,
): ActivePersona[] {
  const ranked = [...personas].sort(
    (a, b) =>
      (usage.get(a.id) ?? 0) - (usage.get(b.id) ?? 0) ||
      a.id.localeCompare(b.id),
  );
  if (ranked.length <= max) return ranked;

  const queues = new Map<string, ActivePersona[]>();
  for (const persona of ranked) {
    for (const topic of persona.card.focus_topics) {
      queues.set(topic, [...(queues.get(topic) ?? []), persona]);
    }
  }
  const topics = [...queues.keys()].sort();
  const chosen = new Map<string, ActivePersona>();
  while (chosen.size < max) {
    let added = false;
    for (const topic of topics) {
      if (chosen.size >= max) break;
      const queue = queues.get(topic) ?? [];
      const next = queue.find((persona) => !chosen.has(persona.id));
      if (next) {
        chosen.set(next.id, next);
        added = true;
      }
    }
    if (!added) break;
  }
  // Keep the least-used order for the router and the fallback (first candidate).
  return ranked.filter((persona) => chosen.has(persona.id));
}

/** Sessions per persona in the last 7 days, cached briefly per instance. */
@Injectable()
export class PersonaUsageService {
  private cache: { at: number; usage: Map<string, number> } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async usage(now = Date.now()): Promise<Map<string, number>> {
    if (this.cache && now - this.cache.at < USAGE_CACHE_MS) {
      return this.cache.usage;
    }
    const rows = await this.prisma.ai_sessions.groupBy({
      by: ['persona_id'],
      where: {
        persona_id: { not: null },
        started_at: { gte: new Date(now - 7 * DAY_MS) },
      },
      _count: { _all: true },
    });
    const usage = new Map(
      rows
        .filter((row) => row.persona_id !== null)
        .map((row) => [row.persona_id as string, row._count._all]),
    );
    this.cache = { at: now, usage };
    return usage;
  }
}
