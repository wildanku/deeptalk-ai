import type { PersonaCard } from '../content/content.schemas';

export type RiskLevel = 'normal' | 'elevated' | 'crisis';

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cached_tokens: number;
}

function tokenUsage(value: unknown): TokenUsage {
  const raw = (
    typeof value === 'object' && value !== null ? value : {}
  ) as Record<string, unknown>;
  const count = (key: string) => {
    const n = raw[key];
    return typeof n === 'number' && Number.isFinite(n) && n >= 0
      ? Math.round(n)
      : 0;
  };
  return {
    input_tokens: count('input_tokens'),
    output_tokens: count('output_tokens'),
    cached_tokens: count('cached_tokens'),
  };
}

/** SSE events from the agent's `POST /v1/turn` (02 §7.1). */
export type AgentEvent =
  /** L2 verdict; always first. Persona tokens are held until it is decided (safety gate). */
  | { event: 'safety'; level: RiskLevel; signals: string[]; timed_out: boolean }
  | { event: 'token'; delta: string }
  /** Card proposal — validated by the gateway before anything reaches the user (02 §7.4). */
  | {
      event: 'structured';
      type: 'routine' | 'assessment' | 'handoff' | 'recommendation';
      data: Record<string, unknown>;
    }
  /**
   * Final reply. `content` is authoritative: when L3 replaced the reply with a safe template,
   * it differs from the streamed tokens and `replaced` is true.
   */
  | {
      event: 'done';
      content: string;
      model: string;
      prompt_version: string;
      replaced: boolean;
      aborted: boolean;
      /** Persona generation tokens (02 §12.3); zeros when the model reports none. */
      usage: TokenUsage;
    }
  | { event: 'error'; code: string }
  | { event: 'other'; name: string };

export interface TurnContext {
  persona: {
    id: string;
    display_name: string;
    version: number;
    card: PersonaCard;
  } | null;
  knowledge: { topic: string; title: string; content: string }[];
  memory: {
    summaries: string[];
    profile: {
      nickname: string | null;
      age_band: string | null;
      /** As stored in v3 (`male`, `female`, `non-binary`, …); the agent words it. */
      gender: string | null;
    };
    routines: { title: string; adherence_7d: number }[];
    assessments: {
      name: string;
      completed_at: string;
      result_category: string | null;
    }[];
  };
  state: {
    risk_level: RiskLevel;
    wrap_up: boolean;
    allow_routine: boolean;
    allow_assessment: boolean;
    allow_handoff: boolean;
    allow_recommendation: boolean;
    offered_cards: string[];
  };
  catalog: {
    routine_items: {
      id: string;
      topic: string;
      title: string;
      description: string;
    }[];
    assessments: { id: string; title: string; topic: string }[];
    /** Psikolog who accept handoffs (`ai_handoff_psikologs`). */
    psikologs: { id: string; name: string; specialists: string[] }[];
    /** Recommendation shortlist from the v3 directory (`recommendation-rules.ts`). */
    directory: {
      id: string;
      name: string;
      specialists: string[];
      year_experience: number | null;
      rating: number | null;
      reviews: number;
      persona: {
        label: string;
        approach: string;
        focus_topics: string[];
      } | null;
    }[];
  };
}

export interface AgentTurnRequest extends TurnContext {
  session_id: string;
  message: string;
  history: { role: 'user' | 'assistant'; content: string }[];
}

/**
 * The agent could not be reached, answered with a non-2xx status, or answered with something
 * that is not the agent's contract (`code`), e.g. AGENT_URL pointing at another service.
 */
export class AgentUnavailableError extends Error {
  constructor(
    readonly status?: number,
    readonly code?:
      'NOT_EVENT_STREAM' | 'BAD_RESPONSE' | 'TIMEOUT_TOTAL' | 'TIMEOUT_IDLE',
  ) {
    super(status ? `Agent answered ${status}` : 'Agent unreachable');
    this.name = 'AgentUnavailableError';
  }
}

const LEVELS: readonly RiskLevel[] = ['normal', 'elevated', 'crisis'];
const CARD_TYPES = [
  'routine',
  'assessment',
  'handoff',
  'recommendation',
] as const;

export function toAgentEvent(
  name: string | undefined,
  data: string,
): AgentEvent {
  const payload = JSON.parse(data) as Record<string, unknown>;
  switch (name) {
    case 'safety':
      if (
        typeof payload.level === 'string' &&
        LEVELS.includes(payload.level as RiskLevel)
      ) {
        return {
          event: 'safety',
          level: payload.level as RiskLevel,
          signals: Array.isArray(payload.signals)
            ? payload.signals.filter((s): s is string => typeof s === 'string')
            : [],
          timed_out: payload.timed_out === true,
        };
      }
      break;
    case 'token':
      if (typeof payload.delta === 'string') {
        return { event: 'token', delta: payload.delta };
      }
      break;
    case 'structured':
      if (
        typeof payload.type === 'string' &&
        (CARD_TYPES as readonly string[]).includes(payload.type) &&
        typeof payload.data === 'object' &&
        payload.data !== null
      ) {
        return {
          event: 'structured',
          type: payload.type as (typeof CARD_TYPES)[number],
          data: payload.data as Record<string, unknown>,
        };
      }
      break;
    case 'done':
      if (
        typeof payload.content === 'string' &&
        typeof payload.model === 'string' &&
        typeof payload.prompt_version === 'string'
      ) {
        return {
          event: 'done',
          content: payload.content,
          model: payload.model,
          prompt_version: payload.prompt_version,
          replaced: payload.replaced === true,
          aborted: payload.aborted === true,
          usage: tokenUsage(payload.usage),
        };
      }
      break;
    case 'error':
      return {
        event: 'error',
        code: typeof payload.code === 'string' ? payload.code : 'UNKNOWN',
      };
    default:
      return { event: 'other', name: name ?? 'message' };
  }
  throw new Error(`Malformed agent event: ${name}`);
}
