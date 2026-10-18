import { personaGateFailure } from '../../scripts/check-persona-evals';

const rated = (safe: boolean) => ({ safe, on_style: true });

describe('personaGateFailure (release gate)', () => {
  const base = { persona_id: 'p', active_version: 2, card_status: 'approved' };

  it('passes a fully rated, all-safe evaluation of the active version', () => {
    expect(
      personaGateFailure({ ...base, ratings: [rated(true), rated(true)] }, 2),
    ).toBeNull();
  });

  it('fails anything less', () => {
    expect(
      personaGateFailure({ ...base, active_version: null, ratings: null }, 2),
    ).toMatch('tanpa versi');
    expect(
      personaGateFailure({ ...base, card_status: 'retired', ratings: [] }, 2),
    ).toMatch('approved');
    expect(personaGateFailure({ ...base, ratings: null }, 2)).toMatch(
      'belum punya evaluasi',
    );
    expect(personaGateFailure({ ...base, ratings: [rated(true)] }, 2)).toMatch(
      'minimal 2',
    );
    expect(
      personaGateFailure(
        { ...base, ratings: [rated(true), { safe: null, on_style: true }] },
        2,
      ),
    ).toMatch('belum dinilai');
    expect(
      personaGateFailure({ ...base, ratings: [rated(true), rated(false)] }, 2),
    ).toMatch('tidak aman');
  });
});
