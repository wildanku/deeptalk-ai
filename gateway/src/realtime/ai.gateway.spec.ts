import { NotFoundException } from '@nestjs/common';
import type { Server } from 'socket.io';
import type { AiPrincipal } from '../auth/ai-principal';
import { AiTokenVerifier } from '../auth/ai-token-verifier.service';
import { createTestIssuer, type TestIssuer } from '../auth/testing';
import { testConfig } from '../config/testing';
import type { UserEmitter } from '../common/emitter/user-emitter.service';
import type { HandoffsService } from '../handoffs/handoffs.service';
import type { RoutinesService } from '../routines/routines.service';
import type { SessionStateService } from './session-state.service';
import { AiGateway, userRoom } from './ai.gateway';
import type { TurnService } from './turn.service';

interface FakeSocket {
  id: string;
  handshake: { auth: Record<string, unknown>; headers: Record<string, string> };
  data: { principal?: AiPrincipal; expiryTimer?: NodeJS.Timeout };
  disconnected: boolean;
  emit: jest.Mock;
  join: jest.Mock;
  disconnect: jest.Mock;
}

function socket(auth: Record<string, unknown> = {}, headers = {}): FakeSocket {
  return {
    id: 's1',
    handshake: { auth, headers },
    data: {},
    disconnected: false,
    emit: jest.fn(),
    join: jest.fn(() => Promise.resolve()),
    disconnect: jest.fn(),
  };
}

describe('AiGateway', () => {
  let issuer: TestIssuer;
  let gateway: AiGateway;
  const STATE = { session_id: null, status: 'none', persona: null };
  const state = {
    view: jest.fn(() => Promise.resolve(STATE)),
    start: jest.fn(() => Promise.resolve()),
    switch: jest.fn(() => Promise.resolve()),
  };
  const routines = { decide: jest.fn() };
  const handoffs = { decide: jest.fn() };
  const emitter = { attach: jest.fn() };
  const sendTurn = jest.fn();
  const turns = { send: sendTurn } as unknown as TurnService;
  const localDisconnect = jest.fn();
  const clusterDisconnect = jest.fn();
  const server = {
    disconnectSockets: clusterDisconnect,
    local: { disconnectSockets: localDisconnect },
  };

  beforeAll(async () => {
    issuer = await createTestIssuer();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    gateway = new AiGateway(
      new AiTokenVerifier(issuer.jwks, testConfig()),
      state as unknown as SessionStateService,
      turns,
      routines as unknown as RoutinesService,
      handoffs as unknown as HandoffsService,
      emitter as unknown as UserEmitter,
    );
    (gateway as unknown as { server: Server }).server =
      server as unknown as Server;
  });

  afterEach(() => jest.useRealTimers());

  const connect = (client: FakeSocket) =>
    gateway.handleConnection(client as never);

  it('authenticates via handshake auth, joins the user room, sends session state', async () => {
    const client = socket({ token: await issuer.sign({ sub: 'u1' }) });

    await connect(client);

    expect(client.disconnect).not.toHaveBeenCalled();
    expect(client.join).toHaveBeenCalledWith(userRoom('u1'));
    expect(client.emit).toHaveBeenCalledWith('session.state', STATE);
    expect(state.view).toHaveBeenCalledWith('u1');
    gateway.handleDisconnect(client as never);
  });

  it('also accepts an Authorization header (native clients)', async () => {
    const client = socket(
      {},
      { authorization: `Bearer ${await issuer.sign({ sub: 'u2' })}` },
    );

    await connect(client);

    expect(client.join).toHaveBeenCalledWith(userRoom('u2'));
    gateway.handleDisconnect(client as never);
  });

  it.each([
    ['no token', () => Promise.resolve(socket())],
    ['an invalid token', () => Promise.resolve(socket({ token: 'nope' }))],
    [
      'a wrong audience',
      async () => socket({ token: await issuer.sign({}, { audience: 'x' }) }),
    ],
  ])('rejects %s', async (_case, make) => {
    const client = await make();

    await connect(client);

    expect(client.emit).toHaveBeenCalledWith(
      'ai.error',
      expect.objectContaining({ code: 'UNAUTHORIZED' }),
    );
    expect(client.disconnect).toHaveBeenCalledWith(true);
    expect(client.join).not.toHaveBeenCalled();
  });

  it('refuses psikolog tokens on the user namespace', async () => {
    const client = socket({ token: await issuer.sign({ role: 'psikolog' }) });

    await connect(client);

    expect(client.emit).toHaveBeenCalledWith(
      'ai.error',
      expect.objectContaining({ code: 'FORBIDDEN' }),
    );
    expect(client.disconnect).toHaveBeenCalledWith(true);
  });

  it('disconnects when the token expires, unless refreshed', async () => {
    jest.useFakeTimers({ now: Date.now() });
    const exp = Math.floor(Date.now() / 1000) + 60;
    const client = socket({
      token: await issuer.sign({ sub: 'u1' }, { expiresIn: exp }),
    });
    await connect(client);

    const refreshed = await gateway.refresh(client as never, {
      token: await issuer.sign({ sub: 'u1' }, { expiresIn: exp + 600 }),
    });
    expect(refreshed).toEqual({ ok: true, expires_at: exp + 600 });
    jest.advanceTimersByTime(61_000);
    expect(client.disconnect).not.toHaveBeenCalled();

    jest.advanceTimersByTime(600_000);
    expect(client.emit).toHaveBeenCalledWith(
      'ai.error',
      expect.objectContaining({ code: 'TOKEN_EXPIRED' }),
    );
    expect(client.disconnect).toHaveBeenCalledWith(true);
  });

  it('refuses a refresh token that belongs to another user', async () => {
    const client = socket({ token: await issuer.sign({ sub: 'u1' }) });
    await connect(client);

    await expect(
      gateway.refresh(client as never, {
        token: await issuer.sign({ sub: 'u9' }),
      }),
    ).resolves.toMatchObject({ ok: false, code: 'FORBIDDEN' });
    gateway.handleDisconnect(client as never);
  });

  it('routes message.send to the turn service for the authenticated user', async () => {
    const client = socket({ token: await issuer.sign({ sub: 'u1' }) });
    await connect(client);
    sendTurn.mockResolvedValue({ ok: true });

    await expect(
      gateway.send(client as never, {
        client_message_id: 'c1',
        content: 'hai',
      }),
    ).resolves.toEqual({ ok: true });
    expect(sendTurn).toHaveBeenCalledWith('u1', {
      client_message_id: 'c1',
      content: 'hai',
    });
    gateway.handleDisconnect(client as never);
  });

  it('attaches the namespace to the user emitter on init', () => {
    gateway.afterInit(server as never);
    expect(emitter.attach).toHaveBeenCalledWith(server);
  });

  it('handles session.start (Quick Chat) and persona.switch', async () => {
    const client = socket({ token: await issuer.sign({ sub: 'u1' }) });
    await connect(client);

    await expect(gateway.sessionStart(client as never, {})).resolves.toEqual({
      ok: true,
    });
    expect(state.start).toHaveBeenCalledWith('u1', null, 'id', null);
    await expect(
      gateway.personaSwitch(client as never, { persona_id: 'p2' }),
    ).resolves.toEqual({ ok: true });
    expect(state.switch).toHaveBeenCalledWith('u1', 'p2');
    await expect(
      gateway.personaSwitch(client as never, {}),
    ).resolves.toMatchObject({
      ok: false,
      code: 'INVALID_REQUEST',
    });
    gateway.handleDisconnect(client as never);
  });

  it('forwards the selected locale from session.start', async () => {
    const client = socket({ token: await issuer.sign({ sub: 'u1' }) });
    await connect(client);

    await expect(
      gateway.sessionStart(client as never, { locale: 'en' }),
    ).resolves.toEqual({ ok: true });
    expect(state.start).toHaveBeenCalledWith('u1', null, 'en', null);
    gateway.handleDisconnect(client as never);
  });

  it('takes a session nickname from session.start, tidied, and refuses odd ones', async () => {
    const client = socket({ token: await issuer.sign({ sub: 'u1' }) });
    await connect(client);

    await expect(
      gateway.sessionStart(client as never, { nickname: '  Rani   Putri ' }),
    ).resolves.toEqual({ ok: true });
    expect(state.start).toHaveBeenLastCalledWith(
      'u1',
      null,
      'id',
      'Rani Putri',
    );

    // Line breaks cannot reach the prompt: whitespace collapses to single spaces.
    await gateway.sessionStart(client as never, { nickname: 'Ran\n\nAndi' });
    expect(state.start).toHaveBeenLastCalledWith('u1', null, 'id', 'Ran Andi');

    for (const nickname of [
      '',
      '   ',
      'a'.repeat(51),
      'Rani <system>',
      '{{name}}',
    ]) {
      await expect(
        gateway.sessionStart(client as never, { nickname }),
      ).resolves.toMatchObject({ ok: false, code: 'INVALID_REQUEST' });
    }
    gateway.handleDisconnect(client as never);
  });

  it('maps domain errors from routine.decision into an ack', async () => {
    const client = socket({ token: await issuer.sign({ sub: 'u1' }) });
    await connect(client);
    routines.decide.mockRejectedValue(
      new NotFoundException('Usulan routine tidak ditemukan'),
    );

    await expect(
      gateway.routineDecision(client as never, {
        proposal_id: '01a11a70-bd60-7e97-a8c2-1a1c3ebfe0c0',
        decision: 'accept',
      }),
    ).resolves.toEqual({
      ok: false,
      code: 'HTTP_404',
      message: 'Usulan routine tidak ditemukan',
    });
    gateway.handleDisconnect(client as never);
  });

  it('refuses decisions on an unauthenticated socket', async () => {
    await expect(
      gateway.handoffDecision(socket() as never, {
        handoff_id: 'x',
        decision: 'approve',
      }),
    ).resolves.toMatchObject({ ok: false, code: 'UNAUTHORIZED' });
  });

  it('turns unexpected failures into a SEND_FAILED ack', async () => {
    const client = socket({ token: await issuer.sign({ sub: 'u1' }) });
    await connect(client);
    sendTurn.mockRejectedValue(new Error('db down: isi pesan'));

    await expect(
      gateway.send(client as never, { client_message_id: 'c1', content: 'x' }),
    ).resolves.toMatchObject({ ok: false, code: 'SEND_FAILED' });
    gateway.handleDisconnect(client as never);
  });

  it('on shutdown disconnects only local sockets, never the whole cluster', () => {
    gateway.onModuleDestroy();

    expect(localDisconnect).toHaveBeenCalledWith(true);
    expect(clusterDisconnect).not.toHaveBeenCalled();
  });
});
