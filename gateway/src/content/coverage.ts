import { EXCLUDED_ROUTINE_TOPICS } from '../routines/routine-rules';

export interface CoverageRow {
  kind: string;
  ref_id: string;
  version: number;
  status: string;
  body: unknown;
}

export interface CoveragePersona {
  id: string;
  status: 'active' | 'disabled';
  /** Focus topics of the newest card version (approved or not). */
  focus_topics: string[];
  approved: boolean;
}

interface Count {
  approved: number;
  draft: number;
}

export interface TopicCoverage {
  topic: string;
  label: string | null;
  routine_allowed: boolean;
  label_approved: boolean;
  personas: Count;
  knowledge: Count;
  routine_items: Count;
  assessment_mapping: Count;
  /** Can be offered: approved label and knowledge, at least one approved persona. */
  ready: boolean;
  missing: string[];
}

/** Kinds whose body names the topic it belongs to. */
const BY_BODY_TOPIC = {
  knowledge: 'knowledge',
  routine_item: 'routine_items',
  assessment_mapping: 'assessment_mapping',
} as const;

const topicOf = (body: unknown): string | null => {
  const topic = (body as { topic?: unknown } | null)?.topic;
  return typeof topic === 'string' ? topic : null;
};

/**
 * Per topic, how much usable clinical content exists (03 Phase 8: adding a topic is content
 * work). A ref counts as approved when any version is approved and not retired; otherwise as
 * draft when it has a draft or in-review version.
 */
export function computeCoverage(
  rows: CoverageRow[],
  personas: CoveragePersona[],
): TopicCoverage[] {
  const byRef = new Map<string, CoverageRow[]>();
  for (const row of rows) {
    const key = `${row.kind}/${row.ref_id}`;
    byRef.set(key, [...(byRef.get(key) ?? []), row]);
  }

  const topics = new Map<string, TopicCoverage>();
  const entry = (topic: string): TopicCoverage => {
    let current = topics.get(topic);
    if (!current) {
      current = {
        topic,
        label: null,
        routine_allowed: !EXCLUDED_ROUTINE_TOPICS.has(topic),
        label_approved: false,
        personas: { approved: 0, draft: 0 },
        knowledge: { approved: 0, draft: 0 },
        routine_items: { approved: 0, draft: 0 },
        assessment_mapping: { approved: 0, draft: 0 },
        ready: false,
        missing: [],
      };
      topics.set(topic, current);
    }
    return current;
  };

  for (const versions of byRef.values()) {
    const approved = versions.find((v) => v.status === 'approved');
    const pending = versions
      .filter((v) => v.status === 'draft' || v.status === 'in_review')
      .sort((a, b) => b.version - a.version)[0];
    const current = approved ?? pending;
    if (!current) continue;
    if (current.kind === 'topic') {
      const topic = entry(current.ref_id);
      const body = current.body as {
        label?: string;
        routine_allowed?: boolean;
      };
      topic.label = body.label ?? null;
      topic.label_approved = Boolean(approved);
      if (body.routine_allowed === false) topic.routine_allowed = false;
      continue;
    }
    const field = BY_BODY_TOPIC[current.kind as keyof typeof BY_BODY_TOPIC];
    const name = topicOf(current.body);
    if (!field || !name) continue;
    entry(name)[field][approved ? 'approved' : 'draft'] += 1;
  }

  for (const persona of personas) {
    if (persona.status !== 'active') continue;
    for (const topic of persona.focus_topics) {
      entry(topic).personas[persona.approved ? 'approved' : 'draft'] += 1;
    }
  }

  for (const topic of topics.values()) {
    if (!topic.label_approved) topic.missing.push('label');
    if (topic.knowledge.approved === 0) topic.missing.push('knowledge');
    if (topic.personas.approved === 0) topic.missing.push('persona');
    if (topic.routine_allowed && topic.routine_items.approved === 0) {
      topic.missing.push('routine_items');
    }
    if (topic.assessment_mapping.approved === 0) {
      topic.missing.push('assessment_mapping');
    }
    topic.ready =
      topic.label_approved &&
      topic.knowledge.approved > 0 &&
      topic.personas.approved > 0;
  }
  return [...topics.values()].sort((a, b) => a.topic.localeCompare(b.topic));
}
