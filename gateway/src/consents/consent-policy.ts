import type { ConsentText } from '../content/content.schemas';

export type ConsentType = 'service' | 'ai_training' | 'legacy_counseling';

export interface ConsentDecision {
  text_version: number;
  granted: boolean;
  created_at: Date;
}

export interface ActiveConsentText {
  version: number;
  draft: boolean;
  body: ConsentText;
}

export interface ConsentState {
  type: ConsentType;
  /** The text to show; null when no usable text exists (consent is then impossible). */
  text: {
    version: number;
    title: string;
    summary: string[];
    body: string;
    translations?: ConsentText['translations'];
    draft: boolean;
  } | null;
  /** Agreed to a version that is still accepted. */
  granted: boolean;
  /** Agreed once, but the text has since changed materially (02 §9.2). */
  reconsent_required: boolean;
  /** The user has an answer for the current text (granted or not). */
  decided: boolean;
  decided_at: string | null;
}

/** Current state from the newest decision and the active text. */
export function consentState(
  type: ConsentType,
  text: ActiveConsentText | null,
  latest: ConsentDecision | null,
): ConsentState {
  const accepted =
    !!text &&
    !!latest?.granted &&
    latest.text_version >= text.body.min_accepted_version;
  return {
    type,
    text: text
      ? {
          version: text.version,
          title: text.body.title,
          summary: text.body.summary,
          body: text.body.body,
          translations: text.body.translations,
          draft: text.draft,
        }
      : null,
    granted: accepted,
    reconsent_required: !!latest?.granted && !accepted && !!text,
    decided:
      !!text &&
      !!latest &&
      latest.text_version >= text.body.min_accepted_version,
    decided_at: latest?.created_at.toISOString() ?? null,
  };
}

/** Sessions before the user's third, or any session that left `normal`, never see the offer. */
export const TRAINING_OFFER_MIN_SESSIONS = 3;
