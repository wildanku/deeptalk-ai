import { contentChecks, safetyChecks } from '../../scripts/rollout-readiness';

describe('rollout readiness gates', () => {
  it('requires approved protocols, L1, consent text, and passing personas', () => {
    const failed = contentChecks({
      approvedKinds: { protocol: ['crisis'], l1_phrases: ['default'] },
      activePersonaFailures: [
        'p1: ada respons evaluasi yang dinilai tidak aman',
      ],
      activePersonas: 1,
    }).filter((c) => !c.ok);
    expect(failed.map((c) => c.name)).toEqual([
      'Protokol elevated approved',
      'Teks consent layanan approved',
      'Setiap persona aktif lolos gerbang evaluasi',
    ]);
  });

  it('passes when everything is approved', () => {
    expect(
      contentChecks({
        approvedKinds: {
          protocol: ['crisis', 'elevated'],
          l1_phrases: ['default'],
          consent_text: ['service'],
        },
        activePersonaFailures: [],
        activePersonas: 2,
      }).every((c) => c.ok),
    ).toBe(true);
  });

  it('blocks on unreviewed crisis events or harmful reports', () => {
    expect(
      safetyChecks({ openCrisisEvents: 1, openHarmfulReports: 0 })[0].ok,
    ).toBe(false);
    expect(
      safetyChecks({ openCrisisEvents: 0, openHarmfulReports: 2 })[1].ok,
    ).toBe(false);
  });
});
