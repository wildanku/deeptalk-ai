/**
 * Knowledge budget (02 §7.3, 03 Phase 8): approved knowledge is injected into the prompt per
 * topic. Past ±50k tokens in total or more than 10 topics, move to Vertex AI RAG Engine (or
 * pgvector in the AI Postgres). Read-only. Exit 1 when a threshold is crossed.
 *
 *   DATABASE_URL=<read-only> pnpm run knowledge:budget
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import type { Check } from './rollout-readiness';

export interface KnowledgeItem {
  topic: string;
  content: string;
}

export interface BudgetLimits {
  tokens: number;
  topics: number;
}

export const DEFAULT_LIMITS: BudgetLimits = { tokens: 50_000, topics: 10 };

/** Rough count (≈ 4 characters per token); good enough for a threshold, not for billing. */
export const estimateTokens = (text: string): number => Math.ceil(text.length / 4);

export function knowledgeBudget(
  items: KnowledgeItem[],
  limits: BudgetLimits = DEFAULT_LIMITS,
): { tokens: number; topics: number; largestTopic: number; check: Check } {
  const perTopic = new Map<string, number>();
  for (const item of items) {
    perTopic.set(item.topic, (perTopic.get(item.topic) ?? 0) + estimateTokens(item.content));
  }
  const tokens = [...perTopic.values()].reduce((sum, n) => sum + n, 0);
  const topics = perTopic.size;
  const largestTopic = Math.max(0, ...perTopic.values());
  const ok = tokens <= limits.tokens && topics <= limits.topics;
  return {
    tokens,
    topics,
    largestTopic,
    check: {
      name: 'Materi pengetahuan masih muat di prompt (belum perlu RAG)',
      ok,
      detail: `±${tokens} token di ${topics} topik (ambang ${limits.tokens} token / ${limits.topics} topik)${
        ok ? '' : ' — pindah ke RAG Engine/pgvector (02 §7.3)'
      }`,
    },
  };
}

/** Approved knowledge only: what production would actually inject. */
export async function approvedKnowledge(prisma: PrismaClient): Promise<KnowledgeItem[]> {
  const rows = await prisma.ai_content_versions.findMany({
    where: { kind: 'knowledge', status: 'approved' },
    select: { body: true },
  });
  return rows.flatMap((row) => {
    const body = row.body as { topic?: unknown; content?: unknown };
    return typeof body.topic === 'string' && typeof body.content === 'string'
      ? [{ topic: body.topic, content: body.content }]
      : [];
  });
}

export function limitsFromEnv(env: NodeJS.ProcessEnv = process.env): BudgetLimits {
  return {
    tokens: Number(env.KNOWLEDGE_RAG_TOKEN_THRESHOLD ?? DEFAULT_LIMITS.tokens),
    topics: Number(env.KNOWLEDGE_RAG_TOPIC_THRESHOLD ?? DEFAULT_LIMITS.topics),
  };
}

async function main(): Promise<void> {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  try {
    const budget = knowledgeBudget(await approvedKnowledge(prisma), limitsFromEnv());
    process.stdout.write(
      `${budget.check.ok ? 'PASS' : 'FAIL'}  ${budget.check.name} — ${budget.check.detail}\n` +
        `      topik terbesar ±${budget.largestTopic} token\n`,
    );
    if (!budget.check.ok) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.name : 'Error'}\n`);
    process.exitCode = 1;
  });
}
