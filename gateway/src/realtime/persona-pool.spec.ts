import type { ActivePersona } from '../content/content.service';
import { routerCandidates } from './persona-pool';

const persona = (id: string, topics: string[]): ActivePersona =>
  ({
    id,
    psychologistId: `psy-${id}`,
    displayName: id,
    version: 1,
    draft: false,
    card: { focus_topics: topics },
  }) as unknown as ActivePersona;

describe('routerCandidates', () => {
  it('orders a small list by least use so the fallback rotates', () => {
    const list = [
      persona('a', ['rokok']),
      persona('b', ['rokok']),
      persona('c', ['tidur']),
    ];
    const usage = new Map([
      ['a', 5],
      ['b', 1],
    ]);
    expect(routerCandidates(list, usage).map((p) => p.id)).toEqual([
      'c',
      'b',
      'a',
    ]);
  });

  it('caps a large list while keeping every topic represented', () => {
    const list = [
      ...Array.from({ length: 10 }, (_, i) => persona(`rokok${i}`, ['rokok'])),
      ...Array.from({ length: 10 }, (_, i) => persona(`tidur${i}`, ['tidur'])),
      persona('cemas', ['kecemasan']),
    ];
    const usage = new Map(list.map((p, i) => [p.id, i]));
    const chosen = routerCandidates(list, usage, 5).map((p) => p.id);

    expect(chosen).toHaveLength(5);
    expect(chosen).toContain('cemas');
    expect(chosen.filter((id) => id.startsWith('rokok'))).toEqual([
      'rokok0',
      'rokok1',
    ]);
    expect(chosen.filter((id) => id.startsWith('tidur'))).toEqual([
      'tidur0',
      'tidur1',
    ]);
  });

  it('does not count a multi-topic persona twice', () => {
    const list = [
      persona('both', ['rokok', 'tidur']),
      persona('r', ['rokok']),
      persona('t', ['tidur']),
    ];
    expect(routerCandidates(list, new Map(), 2).map((p) => p.id)).toEqual([
      'both',
      't',
    ]);
  });
});
