import type { ActivePersona } from '../content/content.service';
import type { V3DirectoryEntry } from '../v3-client/v3-client.service';
import { rankCandidates, validateProposal } from './recommendation-rules';

function entry(
  id: string,
  specialists: string[],
  rating: { rate: number; total: number } | null = null,
): V3DirectoryEntry {
  return {
    id,
    name: `Psikolog ${id}`,
    avatar: null,
    specialists,
    year_experience: 3,
    gender: null,
    rating,
    price_from: 50000,
  };
}

function persona(psychologistId: string, focus: string[]): ActivePersona {
  return {
    id: `ps-${psychologistId}`,
    psychologistId,
    displayName: `Pendekatan ${psychologistId}`,
    version: 1,
    draft: false,
    card: {
      approach: 'Mendengarkan dulu, lalu memetakan pikiran pemicu.',
      focus_topics: focus,
      tone: 'hangat',
      techniques: [],
      questioning_style: 'terbuka',
      always_say: [],
      never_say: [],
      opening: 'Halo',
      few_shots: [],
    },
  };
}

describe('rankCandidates', () => {
  const directory = [
    entry('A', ['Dewasa'], { rate: 5, total: 1 }),
    entry('B', ['Dewasa'], { rate: 4.9, total: 40 }),
    entry('C', ['Karir'], { rate: 4.5, total: 10 }),
    entry('D', ['Pasangan'], null),
    entry('P1', ['Anak dan Remaja'], null),
    entry('P2', ['Dewasa'], null),
  ];

  it('puts psikolog whose persona matches the session topics first', () => {
    const ranked = rankCandidates(
      directory,
      [persona('P1', ['tidur']), persona('P2', ['stres_kerja'])],
      ['stres_kerja'],
    );
    expect(ranked.map((c) => c.id).slice(0, 2)).toEqual(['P2', 'P1']);
    expect(ranked[0].persona?.focus_topics).toEqual(['stres_kerja']);
  });

  it('then covers every specialist, best rated (weighted by reviews) first', () => {
    const ranked = rankCandidates(directory, [], []);
    // Round robin over sorted specialists: Anak dan Remaja, Dewasa, Karir, Pasangan, then Dewasa again.
    expect(ranked.map((c) => c.id)).toEqual(['P1', 'B', 'C', 'D', 'A', 'P2']);
  });

  it('keeps every specialist when the list is cut', () => {
    const ranked = rankCandidates(directory, [], [], 4);
    expect(new Set(ranked.flatMap((c) => c.specialists))).toEqual(
      new Set(['Anak dan Remaja', 'Dewasa', 'Karir', 'Pasangan']),
    );
  });

  it('ignores personas whose psikolog is not in the directory (e.g. DRAFT placeholders)', () => {
    const ranked = rankCandidates(
      directory,
      [persona('DRAFT-PLACEHOLDER-1', ['stres_kerja'])],
      ['stres_kerja'],
    );
    expect(ranked.every((c) => c.persona === null)).toBe(true);
  });

  it('is empty without a directory', () => {
    expect(rankCandidates([], [persona('P1', ['tidur'])], ['tidur'])).toEqual(
      [],
    );
  });
});

describe('validateProposal', () => {
  const candidates = rankCandidates(
    [entry('A', ['Dewasa']), entry('B', ['Karir'])],
    [],
    [],
  );

  it('keeps known psikolog and drops unknown or repeated IDs', () => {
    const result = validateProposal(
      {
        reason: 'Mereka berpengalaman dengan stres kerja.',
        items: [
          { psikolog_id: 'B', reason: 'Spesialis karir.' },
          { psikolog_id: 'X', reason: 'Tidak ada di direktori.' },
          { psikolog_id: 'B', reason: 'Ganda.' },
        ],
      },
      candidates,
    );
    expect(result?.items.map((i) => i.candidate.id)).toEqual(['B']);
  });

  it('rejects a card with nothing valid left, or more than three psikolog', () => {
    expect(
      validateProposal(
        { reason: 'x', items: [{ psikolog_id: 'X', reason: 'x' }] },
        candidates,
      ),
    ).toBeNull();
    const four = ['A', 'B', 'A', 'B'].map((id) => ({
      psikolog_id: id,
      reason: 'x',
    }));
    expect(
      validateProposal({ reason: 'x', items: four }, candidates),
    ).toBeNull();
    expect(validateProposal({ items: [] }, candidates)).toBeNull();
  });
});
