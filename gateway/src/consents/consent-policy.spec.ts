import { ageInYears } from './age';
import { consentState, type ActiveConsentText } from './consent-policy';

const text = (version: number, min: number): ActiveConsentText => ({
  version,
  draft: true,
  body: {
    type: 'service',
    title: 'Ketentuan',
    summary: ['Poin'],
    body: 'Isi',
    min_accepted_version: min,
  },
});
const decision = (version: number, granted: boolean) => ({
  text_version: version,
  granted,
  created_at: new Date('2026-10-10T00:00:00Z'),
});

describe('consentState', () => {
  it('requires a decision when the user never answered', () => {
    expect(consentState('service', text(1, 1), null)).toMatchObject({
      granted: false,
      decided: false,
      reconsent_required: false,
    });
  });

  it('returns the English translation alongside the original consent text', () => {
    const translated = text(7, 1);
    translated.body.translations = {
      en: {
        title: 'DeepTalk AI Terms',
        summary: ['DeepTalk AI is not a psychologist.'],
        body: 'These are temporary beta terms.',
      },
    };

    expect(consentState('service', translated, null).text).toMatchObject({
      title: 'Ketentuan',
      translations: {
        en: {
          title: 'DeepTalk AI Terms',
          summary: ['DeepTalk AI is not a psychologist.'],
          body: 'These are temporary beta terms.',
        },
      },
    });
  });

  it('keeps an agreement across a non-material change', () => {
    expect(
      consentState('service', text(3, 2), decision(2, true)),
    ).toMatchObject({ granted: true, decided: true });
  });

  it('asks again after a material change', () => {
    expect(
      consentState('service', text(3, 3), decision(2, true)),
    ).toMatchObject({
      granted: false,
      decided: false,
      reconsent_required: true,
    });
  });

  it('treats a revocation as decided but not granted', () => {
    expect(
      consentState('ai_training', text(1, 1), decision(1, false)),
    ).toMatchObject({ granted: false, decided: true });
  });

  it('cannot be granted without a text', () => {
    expect(consentState('service', null, decision(1, true))).toMatchObject({
      granted: false,
      text: null,
      reconsent_required: false,
    });
  });
});

describe('ageInYears', () => {
  const now = new Date('2026-10-10T00:00:00Z');

  it('counts whole years, before and on the birthday', () => {
    expect(ageInYears('2008-10-11', now)).toBe(17);
    expect(ageInYears('2008-10-10', now)).toBe(18);
  });

  it('treats missing, malformed, future, or absurd dates as unknown', () => {
    expect(ageInYears(null, now)).toBeNull();
    expect(ageInYears('10/10/2000', now)).toBeNull();
    expect(ageInYears('2030-01-01', now)).toBeNull();
    expect(ageInYears('1800-01-01', now)).toBeNull();
  });
});
