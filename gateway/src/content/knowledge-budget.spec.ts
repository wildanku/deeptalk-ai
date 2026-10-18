import {
  estimateTokens,
  knowledgeBudget,
  limitsFromEnv,
} from '../../scripts/knowledge-budget';

describe('knowledgeBudget (02 §7.3)', () => {
  const item = (topic: string, chars: number) => ({
    topic,
    content: 'x'.repeat(chars),
  });

  it('passes while knowledge fits in the prompt', () => {
    const budget = knowledgeBudget([item('rokok', 4000), item('tidur', 400)]);
    expect(budget).toMatchObject({
      tokens: 1100,
      topics: 2,
      largestTopic: 1000,
    });
    expect(budget.check.ok).toBe(true);
  });

  it('fails past the token threshold', () => {
    expect(
      knowledgeBudget([item('rokok', 400)], { tokens: 50, topics: 10 }).check
        .ok,
    ).toBe(false);
  });

  it('fails past the topic threshold', () => {
    const items = Array.from({ length: 11 }, (_, i) => item(`t${i}`, 4));
    expect(knowledgeBudget(items).check).toMatchObject({ ok: false });
  });

  it('reads thresholds from the environment', () => {
    expect(
      limitsFromEnv({
        KNOWLEDGE_RAG_TOKEN_THRESHOLD: '1000',
        KNOWLEDGE_RAG_TOPIC_THRESHOLD: '3',
      }),
    ).toEqual({ tokens: 1000, topics: 3 });
    expect(estimateTokens('abcde')).toBe(2);
  });
});
