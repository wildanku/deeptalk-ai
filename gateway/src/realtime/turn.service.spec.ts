import type { AgentClient } from '../agent-client/agent-client.service';
import { AgentUnavailableError } from '../agent-client/agent-events';
import { DrainService } from '../common/drain/drain.service';
import type { UserEmitter } from '../common/emitter/user-emitter.service';
import { testConfig } from '../config/testing';
import type { OnboardingService } from '../consents/onboarding.service';
import type { MessagesService } from '../messages/messages.service';
import type { MetricsService } from '../observability/metrics.service';
import type { RedisService } from '../redis/redis.service';
import type { SafetyService } from '../safety/safety.service';
import type { SessionsService } from '../sessions/sessions.service';
import type { ConversationService } from './conversation.service';
import type { SessionStateService } from './session-state.service';
import { TurnService } from './turn.service';

const SESSION = { id: 'sess-1', user_id: 'u1' };
const QUOTA = { used: 10, limit: 10, resets_at: '2026-11-01T00:00:00.000Z' };

describe('TurnService', () => {
  let drain: DrainService;
  let service: TurnService;
  let emitted: [string, string, Record<string, unknown>][];

  const sessions = {
    findActive: jest.fn(),
    findById: jest.fn(),
    openForMessage: jest.fn(),
  };
  const messages = {
    findByClientId: jest.fn(),
    storeUserMessage: jest.fn(),
    isLatest: jest.fn(),
  };
  const conversation = { run: jest.fn(), crisisTurn: jest.fn() };
  const state = {
    pendingChoice: jest.fn(),
    pendingSettings: jest.fn(),
    bindNickname: jest.fn(),
    broadcast: jest.fn(),
  };
  const safety: Record<string, jest.Mock> = {
    l1: jest.fn(),
    protocol: jest.fn(() =>
      Promise.resolve({ contacts: [{ name: 'Darurat', phone: '112' }] }),
    ),
  };
  const agent = { classify: jest.fn() };
  const redis = { tryLock: jest.fn(), release: jest.fn(), hit: jest.fn() };
  const emitter = {
    emit: (user: string, event: string, payload: Record<string, unknown>) =>
      emitted.push([user, event, payload]),
  };
  const metrics = { record: jest.fn() };
  const onboarding = { gate: jest.fn() };

  beforeEach(() => {
    jest.resetAllMocks();
    emitted = [];
    drain = new DrainService();
    safety.protocol.mockImplementation(() =>
      Promise.resolve({ contacts: [{ name: 'Darurat', phone: '112' }] }),
    );
    safety.l1.mockResolvedValue({ level: 'normal', signals: [] });
    redis.hit.mockResolvedValue(1);
    redis.tryLock.mockResolvedValue('lock');
    redis.release.mockResolvedValue(undefined);
    sessions.findActive.mockResolvedValue(null);
    sessions.findById.mockResolvedValue(SESSION);
    sessions.openForMessage.mockResolvedValue({
      kind: 'session',
      session: SESSION,
      created: true,
    });
    messages.findByClientId.mockResolvedValue(null);
    messages.storeUserMessage.mockResolvedValue({
      message: { id: 'm1' },
      duplicate: false,
    });
    state.pendingChoice.mockResolvedValue(null);
    state.pendingSettings.mockResolvedValue({
      personaId: null,
      locale: 'id',
      nickname: null,
    });
    state.bindNickname.mockResolvedValue(undefined);
    conversation.run.mockResolvedValue(undefined);
    conversation.crisisTurn.mockResolvedValue(undefined);
    onboarding.gate.mockResolvedValue(null);
    safety.record = jest.fn().mockResolvedValue(undefined);
    service = new TurnService(
      sessions as unknown as SessionsService,
      messages as unknown as MessagesService,
      conversation as unknown as ConversationService,
      state as unknown as SessionStateService,
      safety as unknown as SafetyService,
      agent as unknown as AgentClient,
      redis as unknown as RedisService,
      emitter as unknown as UserEmitter,
      metrics as unknown as MetricsService,
      drain,
      onboarding as unknown as OnboardingService,
      testConfig({ RATE_LIMIT_MESSAGES_PER_MINUTE: '20' }),
    );
  });

  const send = (content = 'halo', id = 'c1') =>
    service.send('u1', { client_message_id: id, content });

  it('stores, acks, and starts a normal turn', async () => {
    await expect(send()).resolves.toEqual({
      ok: true,
      client_message_id: 'c1',
      message_id: 'm1',
      duplicate: false,
      session_id: 'sess-1',
    });
    await drain.drain(1000);
    expect(emitted).toEqual([
      ['u1', 'message.ack', { client_message_id: 'c1', message_id: 'm1' }],
    ]);
    expect(conversation.run).toHaveBeenCalledWith(
      'sess-1',
      'm1',
      { level: 'normal', signals: [] },
      expect.any(Function),
      'id',
    );
    expect(redis.release).toHaveBeenCalledWith('turn:sess-1', 'lock');
  });

  it('binds the nickname chosen before the first message to the new session', async () => {
    state.pendingSettings.mockResolvedValue({
      personaId: null,
      locale: 'id',
      nickname: 'Ran',
    });

    await expect(send()).resolves.toMatchObject({ ok: true });

    expect(state.bindNickname).toHaveBeenCalledWith('sess-1', 'Ran');
  });

  it('routes an L1 crisis straight to the protocol, opening the session as crisis', async () => {
    safety.l1.mockResolvedValue({ level: 'crisis', signals: ['crisis#1'] });

    await send('aku ingin mati');
    await drain.drain(1000);

    expect(sessions.openForMessage).toHaveBeenCalledWith('u1', {
      personaId: null,
      crisis: true,
    });
    expect(conversation.crisisTurn).toHaveBeenCalledWith(
      SESSION,
      'm1',
      ['crisis#1'],
      'l1',
      expect.any(Function),
    );
    expect(conversation.run).not.toHaveBeenCalled();
  });

  it('never rate-limits a crisis message', async () => {
    redis.hit.mockResolvedValue(999);
    safety.l1.mockResolvedValue({ level: 'crisis', signals: ['crisis#1'] });

    await expect(send('aku ingin mati')).resolves.toMatchObject({ ok: true });
    await drain.drain(1000);
  });

  it('rate-limits ordinary messages', async () => {
    redis.hit.mockResolvedValue(21);

    await expect(send()).resolves.toMatchObject({
      ok: false,
      code: 'RATE_LIMITED',
    });
    expect(messages.storeUserMessage).not.toHaveBeenCalled();
  });

  describe('with the monthly quota used up', () => {
    beforeEach(() => {
      sessions.openForMessage.mockResolvedValueOnce({
        kind: 'quota_exhausted',
        quota: QUOTA,
      });
    });

    it('runs L2 first and only then sends quota.exhausted, with help attached', async () => {
      agent.classify.mockResolvedValue({
        level: 'normal',
        signals: [],
        timed_out: false,
      });

      await expect(send()).resolves.toMatchObject({
        ok: false,
        code: 'QUOTA_EXHAUSTED',
      });

      expect(agent.classify).toHaveBeenCalled();
      expect(emitted).toHaveLength(1);
      expect(emitted[0][1]).toBe('quota.exhausted');
      expect(emitted[0][2]).toMatchObject({
        quota: QUOTA,
        alternatives: ['routine', 'assessment', 'psikolog'],
        help: { contacts: [expect.objectContaining({ phone: '112' })] },
      });
      expect(messages.storeUserMessage).not.toHaveBeenCalled();
    });

    it('opens a crisis session instead when L2 finds crisis', async () => {
      agent.classify.mockResolvedValue({
        level: 'crisis',
        signals: ['l2:plan'],
        timed_out: false,
      });
      sessions.openForMessage.mockResolvedValueOnce({
        kind: 'session',
        session: SESSION,
        created: true,
      });

      await expect(send('udah ga kuat')).resolves.toMatchObject({ ok: true });
      await drain.drain(1000);

      expect(sessions.openForMessage).toHaveBeenLastCalledWith('u1', {
        personaId: null,
        crisis: true,
      });
      expect(emitted.map(([, event]) => event)).not.toContain(
        'quota.exhausted',
      );
      expect(conversation.crisisTurn).toHaveBeenCalledWith(
        SESSION,
        'm1',
        ['l2:plan'],
        'l2',
        expect.any(Function),
      );
    });

    it('treats an unavailable L2 as elevated, never as safe', async () => {
      agent.classify.mockRejectedValue(new AgentUnavailableError());

      await send();

      expect(emitted[0][2]).toMatchObject({ risk_level: 'elevated' });
      expect(metrics.record).toHaveBeenCalledWith('l2_unavailable', {
        path: 'quota',
      });
    });
  });

  it('accepts a crisis message even while another turn holds the lock', async () => {
    redis.tryLock.mockResolvedValue(null);
    sessions.findActive.mockResolvedValue(SESSION);
    safety.l1.mockResolvedValue({ level: 'crisis', signals: ['crisis#2'] });

    await expect(send('aku mau mengakhiri hidup')).resolves.toMatchObject({
      ok: true,
    });
    await drain.drain(1000);

    expect(conversation.crisisTurn).toHaveBeenCalledWith(
      SESSION,
      'm1',
      ['crisis#2'],
      'l1',
      expect.any(Function),
    );
    // Nothing to release: this path never took the lock.
    expect(redis.release).not.toHaveBeenCalled();
  });

  it('refuses a second message while a turn is running, without storing it', async () => {
    redis.tryLock.mockResolvedValue(null);

    await expect(send()).resolves.toMatchObject({
      ok: false,
      code: 'TURN_IN_PROGRESS',
    });
    expect(messages.storeUserMessage).not.toHaveBeenCalled();
  });

  it('re-answers a retried message whose reply was lost', async () => {
    sessions.findActive.mockResolvedValue(SESSION);
    messages.findByClientId.mockResolvedValue({ id: 'm1' });
    messages.isLatest.mockResolvedValue(true);

    await expect(send()).resolves.toMatchObject({
      ok: true,
      duplicate: true,
      message_id: 'm1',
    });
    await drain.drain(1000);

    expect(messages.storeUserMessage).not.toHaveBeenCalled();
    expect(conversation.run).toHaveBeenCalledTimes(1);
  });

  it('only confirms a retried message that was already answered', async () => {
    sessions.findActive.mockResolvedValue(SESSION);
    messages.findByClientId.mockResolvedValue({ id: 'm1' });
    messages.isLatest.mockResolvedValue(false);

    await expect(send()).resolves.toMatchObject({ ok: true, duplicate: true });
    expect(redis.tryLock).not.toHaveBeenCalled();
  });

  it.each([
    [{ content: 'x' }, 'INVALID_MESSAGE'],
    [{ client_message_id: 'bad id!', content: 'x' }, 'INVALID_MESSAGE'],
    [{ client_message_id: 'c1', content: '   ' }, 'EMPTY_MESSAGE'],
    [
      { client_message_id: 'c1', content: '😟'.repeat(2001) },
      'MESSAGE_TOO_LONG',
    ],
  ])('validates input %#', async (body, code) => {
    await expect(service.send('u1', body)).resolves.toMatchObject({
      ok: false,
      code,
    });
    expect(safety.l1).not.toHaveBeenCalled();
  });
  describe('gates before a new session (Phase 4)', () => {
    const refusal = {
      code: 'CONSENT_REQUIRED',
      message:
        'Baca dan setujui ketentuan DeepTalk AI dulu sebelum mulai bercakap.',
    };

    it('refuses without storing the message or opening a session', async () => {
      onboarding.gate.mockResolvedValue(refusal);
      await expect(send()).resolves.toMatchObject({
        ok: false,
        code: 'CONSENT_REQUIRED',
        help: { contacts: [{ name: 'Darurat', phone: '112' }] },
      });
      expect(messages.storeUserMessage).not.toHaveBeenCalled();
      expect(sessions.openForMessage).not.toHaveBeenCalled();
      expect(emitted).toEqual([]);
    });

    it('still sends the crisis protocol to a user outside the gate', async () => {
      onboarding.gate.mockResolvedValue({
        code: 'AGE_REQUIRED',
        message: 'Isi tanggal lahirmu dulu untuk memakai DeepTalk AI.',
      });
      safety.l1.mockResolvedValue({ level: 'crisis', signals: ['l1:x'] });
      await expect(send('pesan sintetis krisis')).resolves.toMatchObject({
        ok: false,
        code: 'AGE_REQUIRED',
      });
      expect(emitted.map(([, event]) => event)).toEqual(['safety.escalation']);
      expect(emitted[0][2]).toMatchObject({ level: 'crisis' });
      expect(safety.record).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: null, level: 'crisis' }),
      );
      expect(messages.storeUserMessage).not.toHaveBeenCalled();
    });

    it('does not re-check the gate inside a running session', async () => {
      sessions.findActive.mockResolvedValue(SESSION);
      await expect(send()).resolves.toMatchObject({ ok: true });
      expect(onboarding.gate).not.toHaveBeenCalled();
    });
  });
});
