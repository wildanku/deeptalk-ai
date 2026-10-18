import type { AgeService } from './age.service';
import type { ConsentsService, ConsentsView } from './consents.service';
import { OnboardingService } from './onboarding.service';
import { testConfig } from '../config/testing';

const noConsents: ConsentsView = {
  service: {
    type: 'service',
    text: null,
    granted: false,
    reconsent_required: false,
    decided: false,
    decided_at: null,
  },
  ai_training: {
    type: 'ai_training',
    text: null,
    granted: false,
    reconsent_required: false,
    decided: false,
    decided_at: null,
  },
  legacy_counseling: {
    type: 'legacy_counseling',
    text: null,
    granted: false,
    reconsent_required: false,
    decided: false,
    decided_at: null,
  },
};

function createService(
  ageStatus: 'ok' | 'missing' | 'restricted' | 'unverified',
  trialBypass = false,
  consentView = noConsents,
) {
  const age = {
    check: jest.fn().mockResolvedValue({ status: ageStatus, min_age: 18 }),
  };
  const consents = {
    view: jest.fn().mockResolvedValue(consentView),
  };
  const service = new OnboardingService(
    age as unknown as AgeService,
    consents as unknown as ConsentsService,
    testConfig({
      AI_TRIAL_ALLOW_WITHOUT_SERVICE_CONSENT: String(trialBypass),
    }),
  );
  return { service, consents };
}

describe('OnboardingService', () => {
  it('allows eligible users without service consent during the configured trial', async () => {
    const { service } = createService('ok', true);

    await expect(service.view('user-1')).resolves.toMatchObject({
      ready: true,
      blocked: null,
      consents: noConsents,
    });
  });

  it.each(['missing', 'restricted', 'unverified'] as const)(
    'keeps the age gate for %s users during the trial',
    async (ageStatus) => {
      const { service } = createService(ageStatus, true);
      const expectedCode = {
        missing: 'AGE_REQUIRED',
        restricted: 'AGE_RESTRICTED',
        unverified: 'AGE_UNVERIFIED',
      }[ageStatus];

      await expect(service.gate('user-1')).resolves.toMatchObject({
        code: expectedCode,
      });
    },
  );

  it('continues to require service consent when the trial bypass is disabled', async () => {
    const { service } = createService('ok');

    await expect(service.gate('user-1')).resolves.toMatchObject({
      code: 'CONSENT_UNAVAILABLE',
    });
  });

  it('respects an explicit service-consent refusal during the trial', async () => {
    const refusal: ConsentsView = {
      ...noConsents,
      service: {
        ...noConsents.service,
        text: {
          version: 1,
          title: 'Service terms',
          summary: [],
          body: 'Terms',
          draft: false,
        },
        decided: true,
      },
    };
    const { service } = createService('ok', true, refusal);

    await expect(service.gate('user-1')).resolves.toMatchObject({
      code: 'CONSENT_REQUIRED',
    });
  });
});
