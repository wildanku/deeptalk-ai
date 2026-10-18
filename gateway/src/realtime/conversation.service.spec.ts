import type { PersonaUsageService } from './persona-pool';
import type { AgentClient } from '../agent-client/agent-client.service';
import {
  type AgentEvent,
  AgentUnavailableError,
} from '../agent-client/agent-events';
import type { AssessmentsService } from '../assessments/assessments.service';
import type { AgentTurnRequest } from '../agent-client/agent-events';
import type { ReferralsService } from '../assessments/referrals.service';
import type { RecommendationsService } from '../recommendations/recommendations.service';
import type { UserEmitter } from '../common/emitter/user-emitter.service';
import { testConfig } from '../config/testing';
import type { ActivePersona, ContentService } from '../content/content.service';
import type { HandoffsService } from '../handoffs/handoffs.service';
import type {
  MessagesService,
  PlainMessage,
} from '../messages/messages.service';
import type { MetricsService } from '../observability/metrics.service';
import type { RedisService } from '../redis/redis.service';
import type { RoutinesService } from '../routines/routines.service';
import type { SafetyService } from '../safety/safety.service';
import type { MemoryService } from '../sessions/memory.service';
import type { SessionTimersService } from '../sessions/session-timers.service';
import type { SessionsService } from '../sessions/sessions.service';
import type { V3Client } from '../v3-client/v3-client.service';
import { ageBand, ConversationService } from './conversation.service';
import type { SessionStateService } from './session-state.service';

const NORMAL_L1 = { level: 'normal' as const, signals: [] };

const PERSONA: ActivePersona = {
  id: 'p1',
  psychologistId: 'psy-1',
  displayName: 'Contoh',
  version: 1,
  draft: true,
  card: {
    approach: 'a',
    focus_topics: ['stres_kerja'],
    tone: 't',
    techniques: [],
    questioning_style: 'q',
    always_say: [],
    never_say: [],
    opening: 'o',
    few_shots: [],
  },
};

function session(overrides: Record<string, unknown> = {}) {
  return {
    id: 's1',
    user_id: 'u1',
    persona_id: 'p1',
    persona_version: 1,
    status: 'active',
    max_risk_level: 'normal',
    normal_streak: 0,
    active_seconds: 0,
    topics: ['stres_kerja'],
    router_reason: null,
    closing_deadline: null,
    ...overrides,
  };
}

const message = (
  id: string,
  role: PlainMessage['role'],
  content: string,
): PlainMessage => ({
  id,
  role,
  content,
  created_at: new Date(),
});

async function* stream(...events: AgentEvent[]): AsyncGenerator<AgentEvent> {
  for (const event of events) yield await Promise.resolve(event);
}

const DONE: AgentEvent = {
  event: 'done',
  content: 'Aku di sini.',
  model: 'm',
  prompt_version: 'p',
  replaced: false,
  aborted: false,
  usage: { input_tokens: 120, output_tokens: 30, cached_tokens: 0 },
};

describe('ConversationService', () => {
  let emitted: [string, string, Record<string, unknown>][];
  let current: ReturnType<typeof session>;

  const sessions = {
    findById: jest.fn(),
    recordActivity: jest.fn(),
    addUsage: jest.fn(),
    applyRisk: jest.fn(),
    setPersona: jest.fn(),
    activeLimitSeconds: 1800,
  };
  const timers = { touch: jest.fn() };
  const state = {
    broadcast: jest.fn(),
    clearPending: jest.fn(),
    sessionNickname: jest.fn(),
  };
  const messages = {
    recent: jest.fn(),
    storeAssistantMessage: jest.fn(),
    storeProtocolMessage: jest.fn(),
  };
  const agent = { streamTurn: jest.fn(), routerSelect: jest.fn() };
  const content = {
    activePersonas: jest.fn(),
    persona: jest.fn(),
    listActive: jest.fn(),
  };
  const safety = {
    record: jest.fn(),
    protocol: jest.fn((level: string) =>
      Promise.resolve({
        level,
        title: 'T',
        message: 'M',
        contacts: [{ name: 'Darurat', phone: '112' }],
        version: 'content/1',
      }),
    ),
  };
  const memory = { recentSummaries: jest.fn() };
  const routines = {
    adherence: jest.fn(),
    activeCount: jest.fn(),
    catalogFor: jest.fn(),
    propose: jest.fn(),
  };
  const assessments = {
    catalogFor: jest.fn(),
    forUser: jest.fn(),
    validate: jest.fn(),
  };
  const handoffs = { directory: jest.fn(), propose: jest.fn() };
  const recommendations = { candidates: jest.fn(), offer: jest.fn() };
  const v3 = { userProfile: jest.fn() };
  const redis = { getJson: jest.fn(), setJson: jest.fn(), del: jest.fn() };
  const emitter = {
    emit: (user: string, event: string, payload: Record<string, unknown>) =>
      emitted.push([user, event, payload]),
  };
  const metrics = { record: jest.fn() };
  const referrals = { offered: jest.fn().mockResolvedValue('ref-1') };

  let service: ConversationService;

  beforeEach(() => {
    jest.clearAllMocks();
    emitted = [];
    current = session();
    sessions.findById.mockImplementation(() => Promise.resolve(current));
    sessions.recordActivity.mockImplementation(() =>
      Promise.resolve({
        session: current,
        warningNow: false,
        closingNow: false,
      }),
    );
    sessions.applyRisk.mockImplementation((_id: string, level: string) => {
      const rank = { normal: 0, elevated: 1, crisis: 2 } as Record<
        string,
        number
      >;
      if (rank[level] > rank[current.max_risk_level])
        current = { ...current, max_risk_level: level };
      return Promise.resolve({
        session: current,
        becameCrisis: level === 'crisis',
      });
    });
    messages.recent.mockResolvedValue([
      message('m0', 'user', 'halo'),
      message('m1', 'user', 'aku capek'),
    ]);
    content.persona.mockResolvedValue(PERSONA);
    content.activePersonas.mockResolvedValue([PERSONA]);
    content.listActive.mockResolvedValue([]);
    memory.recentSummaries.mockResolvedValue([]);
    routines.adherence.mockResolvedValue([]);
    routines.activeCount.mockResolvedValue(0);
    routines.catalogFor.mockResolvedValue([]);
    assessments.catalogFor.mockResolvedValue([]);
    assessments.forUser.mockResolvedValue([]);
    handoffs.directory.mockResolvedValue([]);
    recommendations.candidates.mockResolvedValue([]);
    v3.userProfile.mockResolvedValue(null);
    redis.getJson.mockResolvedValue(null);
    redis.setJson.mockResolvedValue(undefined);
    redis.del.mockResolvedValue(undefined);
    state.sessionNickname.mockResolvedValue(null);
    messages.storeAssistantMessage.mockResolvedValue({
      created_at: new Date('2026-10-18T01:00:00.000Z'),
    });
    service = new ConversationService(
      sessions as unknown as SessionsService,
      timers as unknown as SessionTimersService,
      state as unknown as SessionStateService,
      messages as unknown as MessagesService,
      agent as unknown as AgentClient,
      content as unknown as ContentService,
      safety as unknown as SafetyService,
      memory as unknown as MemoryService,
      routines as unknown as RoutinesService,
      assessments as unknown as AssessmentsService,
      referrals as unknown as ReferralsService,
      handoffs as unknown as HandoffsService,
      recommendations as unknown as RecommendationsService,
      v3 as unknown as V3Client,
      redis as unknown as RedisService,
      emitter as unknown as UserEmitter,
      metrics as unknown as MetricsService,
      {
        usage: () => Promise.resolve(new Map()),
      } as unknown as PersonaUsageService,
      testConfig(),
    );
  });

  const events = () => emitted.map(([, event]) => event);

  it('sends the session nickname over the profile one, with the gender from v3', async () => {
    v3.userProfile.mockResolvedValue({
      nickname: 'Rani',
      birth_date: '1995-01-01',
      gender: 'female',
    });
    state.sessionNickname.mockResolvedValue('Ran');
    agent.streamTurn.mockReturnValue(
      stream(
        { event: 'safety', level: 'normal', signals: [], timed_out: false },
        DONE,
      ),
    );

    await service.run('s1', 'm1', NORMAL_L1);

    const request = (
      agent.streamTurn.mock.calls[0] as [
        { memory: { profile: Record<string, unknown> } },
      ]
    )[0];
    expect(request.memory.profile).toEqual({
      nickname: 'Ran',
      age_band: expect.any(String) as unknown,
      gender: 'female',
    });
  });

  it('marks the reply in progress by ID only, and clears it once delivered', async () => {
    let markedAtDone: unknown = 'unset';
    messages.storeAssistantMessage.mockImplementation(() => {
      markedAtDone = (redis.setJson.mock.calls as [string, unknown][]).find(
        ([key]) => key === 'turn:inflight:s1',
      )?.[1];
      return Promise.resolve({ created_at: new Date('2026-10-18T01:00:00Z') });
    });
    agent.streamTurn.mockReturnValue(
      stream(
        { event: 'safety', level: 'normal', signals: [], timed_out: false },
        DONE,
      ),
    );

    await service.run('s1', 'm1', NORMAL_L1);

    const done = emitted.find(([, event]) => event === 'ai.done')?.[2];
    expect(markedAtDone).toEqual({
      user_message_id: 'm1',
      message_id: done?.message_id,
      started_at: expect.any(String) as unknown,
    });
    expect(done?.created_at).toBe('2026-10-18T01:00:00.000Z');
    expect(redis.del).toHaveBeenCalledWith('turn:inflight:s1');
  });

  it('clears the in-progress marker when the turn fails', async () => {
    agent.streamTurn.mockImplementation(() => {
      throw new AgentUnavailableError(undefined, 'TIMEOUT_TOTAL');
    });

    await service.run('s1', 'm1', NORMAL_L1);

    expect(events()).toContain('ai.error');
    expect(redis.del).toHaveBeenCalledWith('turn:inflight:s1');
    expect(metrics.record).toHaveBeenCalledWith(
      'ai_turn',
      expect.objectContaining({ outcome: 'error' }),
    );
  });

  it('delivers the reply on done, then offers cards that follow it', async () => {
    routines.propose.mockResolvedValue({
      ok: true,
      proposalId: 'rp-1',
      routine: { topic: 'stres_kerja', items: [] },
    });
    agent.streamTurn.mockReturnValue(
      stream(
        { event: 'safety', level: 'normal', signals: [], timed_out: false },
        { event: 'token', delta: 'Aku di sini.' },
        DONE,
        {
          event: 'structured',
          type: 'routine',
          data: { topic: 'stres_kerja', items: [] },
        },
      ),
    );

    await service.run('s1', 'm1', NORMAL_L1);

    expect(events()).toEqual(['ai.token', 'ai.done', 'card.routine']);
  });

  it('keeps a delivered reply when the stream breaks while cards are pending', async () => {
    async function* breaking(): AsyncGenerator<AgentEvent> {
      yield await Promise.resolve<AgentEvent>({
        event: 'safety',
        level: 'normal',
        signals: [],
        timed_out: false,
      });
      yield DONE;
      throw new AgentUnavailableError(undefined, 'TIMEOUT_TOTAL');
    }
    agent.streamTurn.mockReturnValue(breaking());

    await service.run('s1', 'm1', NORMAL_L1);

    expect(events()).toEqual(['ai.done']);
    expect(messages.storeAssistantMessage).toHaveBeenCalledTimes(1);
    expect(metrics.record).toHaveBeenCalledWith('cards_dropped', {
      reason: 'TIMEOUT_TOTAL',
    });
  });

  it('releases the turn lock after storing the reply and before emitting it', async () => {
    const order: string[] = [];
    messages.storeAssistantMessage.mockImplementation(() => {
      order.push('stored');
      return Promise.resolve({ created_at: new Date() });
    });
    const release = jest.fn(() => {
      order.push('released');
      return Promise.resolve();
    });
    agent.streamTurn.mockReturnValue(
      stream(
        { event: 'safety', level: 'normal', signals: [], timed_out: false },
        DONE,
      ),
    );
    const originalEmit = emitter.emit;
    emitter.emit = (user, event, payload) => {
      if (event === 'ai.done') order.push('ai.done');
      return originalEmit(user, event, payload);
    };

    await service.run('s1', 'm1', NORMAL_L1, release);
    emitter.emit = originalEmit;

    expect(order).toEqual(['stored', 'released', 'ai.done']);
  });

  it('holds tokens until the safety verdict, then streams and stores the reply', async () => {
    agent.streamTurn.mockReturnValue(
      stream(
        { event: 'token', delta: 'Aku ' },
        { event: 'safety', level: 'normal', signals: [], timed_out: false },
        { event: 'token', delta: 'di sini.' },
        DONE,
      ),
    );

    await service.run('s1', 'm1', NORMAL_L1);

    expect(events()).toEqual(['ai.token', 'ai.token', 'ai.done']);
    expect(emitted[2][2]).toMatchObject({
      content: 'Aku di sini.',
      replaced: false,
    });
    expect(messages.storeAssistantMessage).toHaveBeenCalledWith(
      's1',
      expect.any(String),
      'Aku di sini.',
      expect.objectContaining({ risk_level: 'normal', persona_version: 1 }),
    );
    const request = (
      agent.streamTurn.mock.calls[0] as [
        {
          message: string;
          history: unknown[];
          persona: { id: string };
        },
      ]
    )[0];
    expect(request.message).toBe('aku capek');
    expect(request.history).toEqual([{ role: 'user', content: 'halo' }]);
    expect(request.persona.id).toBe('p1');
  });

  it('records token usage per session and SLO metrics for the turn', async () => {
    agent.streamTurn.mockReturnValue(
      stream(
        { event: 'safety', level: 'normal', signals: [], timed_out: true },
        { event: 'token', delta: 'Aku di sini.' },
        DONE,
      ),
    );

    await service.run('s1', 'm1', NORMAL_L1);

    expect(sessions.addUsage).toHaveBeenCalledWith('s1', {
      input_tokens: 120,
      output_tokens: 30,
      cached_tokens: 0,
    });
    expect(metrics.record).toHaveBeenCalledWith('l2_verdict', {
      level: 'normal',
      timed_out: true,
    });
    expect(metrics.record).toHaveBeenCalledWith(
      'ai_turn',
      expect.objectContaining({
        outcome: 'ok',
        input_tokens: 120,
        output_tokens: 30,
        first_token_ms: expect.any(Number) as unknown,
      }),
    );
  });

  it('never shows persona tokens for a turn the agent judges crisis', async () => {
    agent.streamTurn.mockReturnValue(
      stream(
        { event: 'token', delta: 'teks persona' },
        {
          event: 'safety',
          level: 'crisis',
          signals: ['l2:self_harm'],
          timed_out: false,
        },
        { event: 'token', delta: 'tidak boleh tampil' },
        DONE,
      ),
    );

    await service.run('s1', 'm1', NORMAL_L1);

    expect(events()).toEqual(['safety.escalation']);
    expect(JSON.stringify(emitted)).not.toContain('teks persona');
    expect(JSON.stringify(emitted)).not.toContain('tidak boleh tampil');
    expect(messages.storeAssistantMessage).not.toHaveBeenCalled();
    expect(messages.storeProtocolMessage).toHaveBeenCalled();
    expect(safety.record).toHaveBeenCalledWith(
      expect.objectContaining({ layer: 'l2', level: 'crisis' }),
    );
    expect(state.broadcast).toHaveBeenCalled();
  });

  it('refuses a reply that arrives without a safety verdict', async () => {
    agent.streamTurn.mockReturnValue(
      stream({ event: 'token', delta: 'tanpa vonis' }, DONE),
    );

    await service.run('s1', 'm1', NORMAL_L1);

    expect(events()).toEqual(['ai.error']);
    expect(messages.storeAssistantMessage).not.toHaveBeenCalled();
  });

  it('fails closed with help information when the agent is unavailable', async () => {
    agent.streamTurn.mockImplementation(() =>
      (async function* () {
        yield* stream();
        throw new AgentUnavailableError();
      })(),
    );

    await service.run('s1', 'm1', NORMAL_L1);

    expect(events()).toEqual(['ai.error']);
    expect(emitted[0][2]).toMatchObject({
      code: 'AI_UNAVAILABLE',
      message_id: 'm1',
      help: { contacts: [expect.objectContaining({ phone: '112' })] },
    });
  });

  it('escalates once when the session first becomes elevated', async () => {
    agent.streamTurn.mockReturnValue(
      stream(
        { event: 'safety', level: 'elevated', signals: [], timed_out: true },
        DONE,
      ),
    );

    await service.run('s1', 'm1', NORMAL_L1);

    expect(events()[0]).toBe('safety.escalation');
    expect(emitted[0][2]).toMatchObject({ level: 'elevated' });
    expect(safety.record).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'elevated', signals: ['l2:timeout'] }),
    );
    expect(events()).toContain('ai.done');
  });

  it('uses L1 elevated even when L2 says normal', async () => {
    agent.streamTurn.mockReturnValue(
      stream(
        { event: 'safety', level: 'normal', signals: [], timed_out: false },
        DONE,
      ),
    );

    await service.run('s1', 'm1', {
      level: 'elevated',
      signals: ['elevated#0'],
    });

    expect(sessions.applyRisk).toHaveBeenCalledWith('s1', 'elevated');
  });

  it('records an L3 replacement', async () => {
    agent.streamTurn.mockReturnValue(
      stream(
        { event: 'safety', level: 'normal', signals: [], timed_out: false },
        { ...DONE, replaced: true, content: 'template aman' },
      ),
    );

    await service.run('s1', 'm1', NORMAL_L1);

    expect(safety.record).toHaveBeenCalledWith(
      expect.objectContaining({ layer: 'l3' }),
    );
    expect(emitted.at(-1)?.[2]).toMatchObject({
      content: 'template aman',
      replaced: true,
    });
  });

  it('switches to a fallback persona when the chosen one was disabled', async () => {
    content.persona.mockResolvedValue(null);
    content.activePersonas.mockResolvedValue([
      { ...PERSONA, id: 'p2', displayName: 'Lain' },
    ]);
    agent.streamTurn.mockReturnValue(
      stream(
        { event: 'safety', level: 'normal', signals: [], timed_out: false },
        DONE,
      ),
    );

    await service.run('s1', 'm1', NORMAL_L1);

    expect(events()[0]).toBe('persona.unavailable');
    expect(emitted[0][2]).toMatchObject({
      persona_id: 'p1',
      fallback_persona: { id: 'p2' },
    });
    expect(sessions.setPersona).toHaveBeenCalledWith(
      's1',
      expect.objectContaining({ id: 'p2' }),
    );
  });

  it('routes Quick Chat through the router and shares the reason', async () => {
    current = session({ persona_id: null });
    agent.routerSelect.mockResolvedValue({
      persona_id: 'p1',
      reason: 'I matched you with the reflective approach.',
      initial_risk: 'normal',
      topics: ['stres_kerja'],
    });
    agent.streamTurn.mockReturnValue(
      stream(
        { event: 'safety', level: 'normal', signals: [], timed_out: false },
        DONE,
      ),
    );

    await service.run('s1', 'm1', NORMAL_L1, undefined, 'en');

    expect(sessions.setPersona).toHaveBeenCalledWith(
      's1',
      { id: 'p1', version: 1, topics: ['stres_kerja'] },
      'I matched you with the reflective approach.',
    );
    expect(agent.routerSelect).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'aku capek', locale: 'en' }),
    );
    expect(state.clearPending).toHaveBeenCalledWith('u1');
  });

  it('uses an English Quick Chat fallback reason when the router is unavailable', async () => {
    current = session({ persona_id: null });
    agent.routerSelect.mockRejectedValue(new Error('router unavailable'));
    agent.streamTurn.mockReturnValue(
      stream(
        { event: 'safety', level: 'normal', signals: [], timed_out: false },
        DONE,
      ),
    );

    await service.run('s1', 'm1', NORMAL_L1, undefined, 'en');

    expect(sessions.setPersona).toHaveBeenCalledWith(
      's1',
      expect.objectContaining({ id: 'p1' }),
      "I'm connecting you with the Contoh approach.",
    );
  });

  it('drops cards that fail validation and emits valid ones after the reply', async () => {
    agent.streamTurn.mockReturnValue(
      stream(
        { event: 'safety', level: 'normal', signals: [], timed_out: false },
        {
          event: 'structured',
          type: 'routine',
          data: { topic: 'rokok', items: [{ library_item_id: 'fake' }] },
        },
        {
          event: 'structured',
          type: 'assessment',
          data: { assessment_id: 'a1', topic: 'kecemasan', reason: 'r' },
        },
        DONE,
      ),
    );
    routines.propose.mockResolvedValue({ ok: false, reason: 'unknown_item' });
    assessments.validate.mockResolvedValue({
      assessment_id: 'a1',
      title: 'Tes',
      reason: 'r',
      is_free: true,
      topic: 'kecemasan',
    });

    await service.run('s1', 'm1', NORMAL_L1);

    expect(events()).toEqual(['ai.done', 'card.assessment']);
    // Every offered assessment is a referral the impact indicators count (Konsep §8).
    expect(emitted[1][2]).toMatchObject({ referral_id: 'ref-1' });
    expect(referrals.offered).toHaveBeenCalledWith(
      'u1',
      's1',
      expect.anything(),
    );
    expect(metrics.record).toHaveBeenCalledWith('card_rejected', {
      type: 'routine',
      reason: 'unknown_item',
    });
  });

  it('sends the directory shortlist to the agent and emits a validated recommendation card', async () => {
    recommendations.candidates.mockResolvedValue([
      {
        id: 'SPS1',
        name: 'Psikolog Satu',
        avatar: null,
        specialists: ['Karir'],
        year_experience: 4,
        rating: { rate: 4.9, total: 12 },
        price_from: 50000,
        persona: null,
      },
    ]);
    const card = {
      recommendation_id: 'rec-1',
      reason: 'r',
      psikologs: [{ id: 'SPS1', reason: 'r', persona_label: null }],
    };
    recommendations.offer.mockResolvedValue(card);
    agent.streamTurn.mockReturnValue(
      stream(
        { event: 'safety', level: 'normal', signals: [], timed_out: false },
        {
          event: 'structured',
          type: 'recommendation',
          data: { reason: 'r', items: [{ psikolog_id: 'SPS1', reason: 'r' }] },
        },
        DONE,
      ),
    );

    await service.run('s1', 'm1', NORMAL_L1);

    const [request] = agent.streamTurn.mock.calls[0] as [AgentTurnRequest];
    expect(request.state.allow_recommendation).toBe(true);
    expect(request.catalog.directory).toEqual([
      expect.objectContaining({ id: 'SPS1', rating: 4.9, reviews: 12 }),
    ]);
    expect(events()).toEqual(['ai.done', 'card.recommendation']);
    expect(emitted[1][2]).toEqual(card);
    // Anchored to the reply the client just received in `ai.done`.
    const done = emitted[0][2] as { message_id: string };
    expect(recommendations.offer).toHaveBeenCalledWith({
      userId: 'u1',
      sessionId: 's1',
      input: expect.anything() as unknown,
      messageId: done.message_id,
    });
  });

  it('serves the L1 crisis protocol without calling the agent', async () => {
    await service.crisisTurn(current as never, 'm1', ['crisis#0'], 'l1');

    expect(agent.streamTurn).not.toHaveBeenCalled();
    expect(events()).toEqual(['safety.escalation']);
    expect(emitted[0][2]).toMatchObject({
      level: 'crisis',
      protocol: { contacts: [expect.anything()] },
    });
    expect(safety.record).toHaveBeenCalledWith(
      expect.objectContaining({
        layer: 'l1',
        level: 'crisis',
        signals: ['crisis#0'],
      }),
    );
  });
});

describe('ageBand', () => {
  it('maps birth dates to coarse bands only', () => {
    const now = new Date('2026-10-10T00:00:00Z');
    expect(ageBand('1999-04-01', now)).toBe('25-34');
    expect(ageBand('2010-01-01', now)).toBe('under_18');
    expect(ageBand(null, now)).toBeNull();
  });
});
