import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createParser } from 'eventsource-parser';
import { GoogleAuth, type IdTokenClient } from 'google-auth-library';
import type { Environment } from '../config/env.schema';
import {
  type AgentEvent,
  type AgentTurnRequest,
  AgentUnavailableError,
  type TurnContext,
  toAgentEvent,
} from './agent-events';

/**
 * Client for the private agent service. In production every call carries a Google-signed ID
 * token for the agent URL (Cloud Run IAM invoker); clients never reach the agent directly.
 */
@Injectable()
export class AgentClient {
  private readonly baseUrl: string | undefined;
  private readonly timeoutMs: number;
  private readonly turnTimeoutMs: number;
  private readonly idleTimeoutMs: number;
  private readonly cardsGraceMs: number;
  private readonly routerTimeoutMs: number;
  private readonly useIdToken: boolean;
  private idTokenClient: Promise<IdTokenClient> | null = null;

  constructor(
    config: ConfigService<Environment, true>,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.baseUrl = config
      .get('AGENT_URL', { infer: true })
      ?.replace(/\/+$/, '');
    this.timeoutMs = config.get('AGENT_TIMEOUT_MS', { infer: true });
    this.turnTimeoutMs = config.get('AGENT_TURN_TIMEOUT_MS', { infer: true });
    this.idleTimeoutMs = config.get('AGENT_IDLE_TIMEOUT_MS', { infer: true });
    this.cardsGraceMs = config.get('AGENT_CARDS_GRACE_MS', { infer: true });
    this.routerTimeoutMs = config.get('ROUTER_TIMEOUT_MS', { infer: true });
    this.useIdToken = config.get('AGENT_AUTH', { infer: true }) === 'id_token';
  }

  /**
   * One turn as agent events. Three clocks, all started after the ID token is in hand (fetching
   * it is not the agent being slow): the turn deadline up to `done`, an idle limit between
   * chunks, and — once `done` has passed — a short grace for the card events that follow it.
   * A timeout surfaces as `AgentUnavailableError` with code `TIMEOUT_TOTAL` or `TIMEOUT_IDLE`.
   */
  async *streamTurn(
    request: AgentTurnRequest,
    signal?: AbortSignal,
  ): AsyncGenerator<AgentEvent> {
    if (!this.baseUrl) throw new AgentUnavailableError();
    let auth: Record<string, string>;
    try {
      auth = await this.authHeaders();
    } catch {
      throw new AgentUnavailableError();
    }

    const deadline = new AbortController();
    // Held in an object: TypeScript does not track assignments made inside callbacks.
    const state: {
      malformed: Error | null;
      timedOut: 'TIMEOUT_TOTAL' | 'TIMEOUT_IDLE' | null;
    } = { malformed: null, timedOut: null };
    const expire = (code: 'TIMEOUT_TOTAL' | 'TIMEOUT_IDLE') => () => {
      state.timedOut ??= code;
      deadline.abort();
    };
    let total = setTimeout(expire('TIMEOUT_TOTAL'), this.turnTimeoutMs);
    let idle = setTimeout(expire('TIMEOUT_IDLE'), this.idleTimeoutMs);
    const unavailable = (status?: number) =>
      new AgentUnavailableError(status, state.timedOut ?? undefined);

    try {
      let response: Response;
      try {
        response = await this.fetchImpl(`${this.baseUrl}/v1/turn`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'text/event-stream',
            ...auth,
          },
          body: JSON.stringify(request),
          signal: signal
            ? AbortSignal.any([signal, deadline.signal])
            : deadline.signal,
        });
      } catch {
        throw unavailable();
      }
      if (!response.ok || !response.body) {
        throw new AgentUnavailableError(response.status);
      }
      if (
        !response.headers.get('content-type')?.startsWith('text/event-stream')
      ) {
        throw new AgentUnavailableError(response.status, 'NOT_EVENT_STREAM');
      }

      const pending: AgentEvent[] = [];
      const parser = createParser({
        onEvent: (message) => {
          try {
            pending.push(toAgentEvent(message.event, message.data));
          } catch (error) {
            state.malformed =
              error instanceof Error ? error : new Error(String(error));
          }
        },
      });
      const decoder = new TextDecoder();
      const reader = response.body.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          // Any byte counts as life, the agent's SSE pings included.
          clearTimeout(idle);
          idle = setTimeout(expire('TIMEOUT_IDLE'), this.idleTimeoutMs);
          parser.feed(decoder.decode(value, { stream: true }));
          if (state.malformed) throw state.malformed;
          while (pending.length > 0) {
            const event = pending.shift() as AgentEvent;
            if (event.event === 'done') {
              // The reply is complete; whatever follows (cards) gets only a short grace.
              clearTimeout(total);
              total = setTimeout(expire('TIMEOUT_TOTAL'), this.cardsGraceMs);
            }
            yield event;
          }
        }
      } catch {
        // A malformed event is a contract bug; anything else is a broken or timed-out stream.
        if (state.malformed) throw state.malformed;
        throw unavailable();
      } finally {
        reader.releaseLock();
      }
    } finally {
      clearTimeout(total);
      clearTimeout(idle);
    }
  }

  /** Quick Chat: pick a persona for the first message (02 §7.1). */
  routerSelect(body: {
    message: string;
    locale?: 'id' | 'en';
    personas: {
      id: string;
      display_name: string;
      approach: string;
      focus_topics: string[];
    }[];
  }): Promise<{
    persona_id: string;
    reason: string;
    initial_risk: 'normal' | 'elevated' | 'crisis';
    topics: string[];
  }> {
    return this.postJson('/v1/router/select', body, this.routerTimeoutMs);
  }

  /** L2 only — used when the quota is exhausted and no persona reply follows (02 §6.3). */
  classify(body: {
    message: string;
    history: { role: 'user' | 'assistant'; content: string }[];
  }): Promise<{
    level: 'normal' | 'elevated' | 'crisis';
    signals: string[];
    timed_out: boolean;
  }> {
    return this.postJson('/v1/safety/classify', body);
  }

  async summarize(body: {
    history: { role: 'user' | 'assistant'; content: string }[];
  }): Promise<{ summary: string; model: string; prompt_version: string }> {
    const result = await this.postJson<{
      summary: string;
      model: string;
      prompt_version: string;
    }>('/v1/session/summary', body);
    // The summary is encrypted and stored as-is; anything else is not the agent answering.
    if (typeof result?.summary !== 'string')
      throw new AgentUnavailableError(200, 'BAD_RESPONSE');
    return result;
  }

  handoffDraft(body: {
    history: { role: 'user' | 'assistant'; content: string }[];
    psikolog: { id: string; name: string; specialists: string[] };
    reason: string;
    routines: { title: string; adherence_7d: number }[];
    assessments: {
      name: string;
      completed_at: string;
      result_category: string | null;
    }[];
    risk_level: 'normal' | 'elevated' | 'crisis';
  }): Promise<{
    sections: { id: string; title: string; body: string }[];
    disclaimer: string;
    model: string;
    prompt_version: string;
  }> {
    return this.postJson('/v1/handoff/draft', body);
  }

  /** Draft Persona Card from a psikolog's questionnaire and few-shot answers (tier Pro). */
  personaDraft(body: {
    display_name: string;
    answers: { question: string; answer: string }[];
    few_shots: { scenario: string; response: string }[];
  }): Promise<{
    card: Record<string, unknown>;
    model: string;
    prompt_version: string;
  }> {
    return this.postJson('/v1/persona/draft', body);
  }

  /**
   * The persona's answer to synthetic evaluation cases, through the same safety layers as a
   * real turn (L2 verdict, L3 replacement). Called with one case at a time.
   */
  evalRun(body: {
    persona: TurnContext['persona'];
    knowledge: TurnContext['knowledge'];
    cases: { case_id: string; scenario: string }[];
  }): Promise<{
    results: {
      case_id: string;
      response: string;
      risk_level: 'normal' | 'elevated' | 'crisis';
      signals: string[];
      replaced: boolean;
    }[];
    model: string;
    prompt_version: string;
  }> {
    return this.postJson('/v1/eval/run', body);
  }

  private async postJson<T>(
    path: string,
    body: unknown,
    timeoutMs = this.timeoutMs,
  ): Promise<T> {
    if (!this.baseUrl) throw new AgentUnavailableError();
    let response: Response;
    try {
      // The clock starts once the ID token is in hand, as for turns.
      const auth = await this.authHeaders();
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          ...auth,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw new AgentUnavailableError(
        undefined,
        error instanceof DOMException && error.name === 'TimeoutError'
          ? 'TIMEOUT_TOTAL'
          : undefined,
      );
    }
    if (!response.ok) throw new AgentUnavailableError(response.status);
    try {
      return (await response.json()) as T;
    } catch {
      throw new AgentUnavailableError(response.status);
    }
  }

  private async authHeaders(): Promise<Record<string, string>> {
    if (!this.useIdToken || !this.baseUrl) return {};
    this.idTokenClient ??= new GoogleAuth().getIdTokenClient(this.baseUrl);
    const headers = await (
      await this.idTokenClient
    ).getRequestHeaders(this.baseUrl);
    const authorization = headers.get('authorization');
    return authorization ? { authorization } : {};
  }
}
