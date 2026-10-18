import { computeCoverage, type CoverageRow } from './coverage';

const row = (
  kind: string,
  ref_id: string,
  status: string,
  body: unknown,
  version = 1,
): CoverageRow => ({ kind, ref_id, version, status, body });

describe('computeCoverage', () => {
  it('counts approved and draft content per topic and lists what is missing', () => {
    const coverage = computeCoverage(
      [
        row('topic', 'tidur', 'approved', {
          label: 'Tidur',
          routine_allowed: true,
        }),
        row('knowledge', 'tidur', 'approved', { topic: 'tidur' }),
        row('routine_item', 'tdr_a', 'draft', { topic: 'tidur' }),
        row('routine_item', 'tdr_b', 'in_review', { topic: 'tidur' }),
        row('topic', 'makan', 'draft', { label: 'Makan' }),
        row('knowledge', 'makan', 'draft', { topic: 'makan' }),
      ],
      [
        { id: 'p1', status: 'active', focus_topics: ['tidur'], approved: true },
        {
          id: 'p2',
          status: 'active',
          focus_topics: ['tidur', 'makan'],
          approved: false,
        },
        {
          id: 'p3',
          status: 'disabled',
          focus_topics: ['makan'],
          approved: true,
        },
      ],
    );

    expect(coverage).toEqual([
      expect.objectContaining({
        topic: 'makan',
        label: 'Makan',
        label_approved: false,
        // Konsep §3.6: eating is never a routine topic.
        routine_allowed: false,
        personas: { approved: 0, draft: 1 },
        knowledge: { approved: 0, draft: 1 },
        ready: false,
        missing: ['label', 'knowledge', 'persona', 'assessment_mapping'],
      }),
      expect.objectContaining({
        topic: 'tidur',
        label_approved: true,
        personas: { approved: 1, draft: 1 },
        knowledge: { approved: 1, draft: 0 },
        routine_items: { approved: 0, draft: 2 },
        ready: true,
        missing: ['routine_items', 'assessment_mapping'],
      }),
    ]);
  });

  it('counts a ref once, as approved when any version is approved', () => {
    const [topic] = computeCoverage(
      [
        row('knowledge', 'rokok', 'approved', { topic: 'rokok' }, 1),
        row('knowledge', 'rokok', 'draft', { topic: 'rokok' }, 2),
      ],
      [],
    );
    expect(topic.knowledge).toEqual({ approved: 1, draft: 0 });
  });

  it('honours routine_allowed: false on the topic', () => {
    const [topic] = computeCoverage(
      [
        row('topic', 'duka', 'approved', {
          label: 'Duka',
          routine_allowed: false,
        }),
      ],
      [],
    );
    expect(topic.routine_allowed).toBe(false);
    expect(topic.missing).not.toContain('routine_items');
  });
});
