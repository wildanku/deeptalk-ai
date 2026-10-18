/**
 * Where a psikolog is in persona curation (03 Phase 5), for the dashboard home card. Computed
 * from what exists; reading it never creates a workspace.
 */
export type PersonaStage =
  /** No questionnaire content yet: nothing to fill in. */
  | 'unavailable'
  | 'not_started'
  | 'questionnaire'
  /** Questionnaire done; at least one example case study still needed for the draft. */
  | 'cases'
  /** Ready for the AI to draft the Persona Card. */
  | 'draft'
  /** A draft exists: evaluate it and approve a version. */
  | 'review'
  | 'active'
  | 'disabled';

export interface PersonaStatusInput {
  questionnaireAvailable: boolean;
  workspace: {
    displayName: string | null;
    answered: number;
    required: number;
  } | null;
  fewShotAnswered: number;
  versions: number;
  persona: {
    status: 'active' | 'disabled';
    activeVersion: number | null;
  } | null;
}

export function personaStage(input: PersonaStatusInput): PersonaStage {
  if (input.persona?.activeVersion != null) {
    return input.persona.status === 'active' ? 'active' : 'disabled';
  }
  if (input.versions > 0) return 'review';
  if (!input.questionnaireAvailable) return 'unavailable';
  const ws = input.workspace;
  if (!ws || (ws.answered === 0 && !ws.displayName)) return 'not_started';
  if (!ws.displayName || ws.answered < ws.required) return 'questionnaire';
  if (input.fewShotAnswered === 0) return 'cases';
  return 'draft';
}
