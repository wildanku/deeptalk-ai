import type { ActivePersona } from './content.service';

export interface PersonaView {
  id: string;
  display_name: string;
  /** "DeepTalk AI dengan pendekatan <display_name>" (Konsep §3.1). */
  label: string;
  approach: string;
  focus_topics: string[];
  draft: boolean;
}

export function personaView(persona: ActivePersona): PersonaView {
  return {
    id: persona.id,
    display_name: persona.displayName,
    label: `DeepTalk AI dengan pendekatan ${persona.displayName}`,
    approach: persona.card.approach,
    focus_topics: persona.card.focus_topics,
    draft: persona.draft,
  };
}
