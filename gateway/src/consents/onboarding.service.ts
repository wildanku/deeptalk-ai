import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type AgeCheck, AgeService } from './age.service';
import { type ConsentsView, ConsentsService } from './consents.service';
import type { Environment } from '../config/env.schema';

export interface GateRefusal {
  code:
    | 'AGE_REQUIRED'
    | 'AGE_RESTRICTED'
    | 'AGE_UNVERIFIED'
    | 'CONSENT_UNAVAILABLE'
    | 'CONSENT_REQUIRED'
    | 'RECONSENT_REQUIRED';
  message: string;
}

export interface OnboardingView {
  ready: boolean;
  blocked: GateRefusal | null;
  age: AgeCheck;
  consents: ConsentsView;
}

/**
 * What must be true before a user's first message: an accepted age and, outside the explicitly
 * enabled beta trial, an agreed `service` consent for a text that is still accepted. The help
 * screen never needs either, and a crisis message is answered even when a gate refuses it.
 */
@Injectable()
export class OnboardingService {
  private readonly trialConsentBypass: boolean;

  constructor(
    private readonly age: AgeService,
    private readonly consents: ConsentsService,
    config: ConfigService<Environment, true>,
  ) {
    this.trialConsentBypass = config.get(
      'AI_TRIAL_ALLOW_WITHOUT_SERVICE_CONSENT',
      { infer: true },
    );
  }

  async view(userId: string): Promise<OnboardingView> {
    const [age, consents] = await Promise.all([
      this.age.check(userId),
      this.consents.view(userId),
    ]);
    const blocked = refusal(age, consents, this.trialConsentBypass);
    return { ready: blocked === null, blocked, age, consents };
  }

  async gate(userId: string): Promise<GateRefusal | null> {
    return (await this.view(userId)).blocked;
  }
}

function refusal(
  age: AgeCheck,
  consents: ConsentsView,
  trialConsentBypass: boolean,
): GateRefusal | null {
  switch (age.status) {
    case 'missing':
      return {
        code: 'AGE_REQUIRED',
        message: 'Isi tanggal lahirmu dulu untuk memakai DeepTalk AI.',
      };
    case 'restricted':
      return {
        code: 'AGE_RESTRICTED',
        message: `DeepTalk AI saat ini hanya tersedia untuk pengguna berusia ${age.min_age} tahun ke atas.`,
      };
    case 'unverified':
      return {
        code: 'AGE_UNVERIFIED',
        message:
          'Kami belum bisa memeriksa data akunmu. Coba lagi sebentar lagi.',
      };
    case 'ok':
      break;
  }
  const service = consents.service;
  if (
    trialConsentBypass &&
    !(service.decided && !service.granted && !service.reconsent_required)
  ) {
    return null;
  }

  if (!service.text) {
    return {
      code: 'CONSENT_UNAVAILABLE',
      message: 'DeepTalk AI belum bisa dipakai saat ini.',
    };
  }
  if (service.granted) return null;
  return service.reconsent_required
    ? {
        code: 'RECONSENT_REQUIRED',
        message:
          'Ketentuan DeepTalk AI diperbarui. Baca dan setujui versi terbaru untuk melanjutkan.',
      }
    : {
        code: 'CONSENT_REQUIRED',
        message:
          'Baca dan setujui ketentuan DeepTalk AI dulu sebelum mulai bercakap.',
      };
}
