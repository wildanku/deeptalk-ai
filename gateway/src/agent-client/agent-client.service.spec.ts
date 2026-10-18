import { testConfig } from '../config/testing';
import { AgentClient } from './agent-client.service';
import { type AgentEvent, AgentUnavailableError } from './agent-events';

function sseResponse(chunks: string[], status = 200): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/event-stream' },
  });
}

async function collect(
  stream: AsyncGenerator<AgentEvent>,
): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

/** An SSE body written over time that fails like a real fetch body when its signal aborts. */
function timedFetch(
  schedule: [delayMs: number, chunk: string][],
  close = false,
) {
  return jest.fn((_url: string, init: RequestInit) => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const timers: ReturnType<typeof setTimeout>[] = [];
        init.signal?.addEventListener('abort', () => {
          timers.forEach(clearTimeout);
          controller.error(new DOMException('aborted', 'AbortError'));
        });
        let at = 0;
        for (const [delay, chunk] of schedule) {
          at += delay;
          timers.push(
            setTimeout(() => controller.enqueue(encoder.encode(chunk)), at),
          );
        }
        if (close) timers.push(setTimeout(() => controller.close(), at));
      },
    });
    return Promise.resolve(
      new Response(body, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      }),
    );
  }) as unknown as typeof fetch;
}

const SAFETY_SSE = 'event: safety\ndata: {"level":"normal","signals":[]}\n\n';
const DONE_SSE =
  'event: done\ndata: {"content":"Hai","model":"m","prompt_version":"p","replaced":false}\n\n';

async function failureCode(stream: AsyncGenerator<AgentEvent>) {
  const seen: string[] = [];
  try {
    for await (const event of stream) seen.push(event.event);
  } catch (error) {
    return { seen, code: (error as AgentUnavailableError).code };
  }
  return { seen, code: 'none' };
}

const request = {
  session_id: 's1',
  message: 'hai',
  history: [],
  persona: null,
  knowledge: [],
  memory: {
    summaries: [],
    profile: { nickname: null, age_band: null, gender: null },
    routines: [],
    assessments: [],
  },
  state: {
    risk_level: 'normal' as const,
    wrap_up: false,
    allow_routine: false,
    allow_assessment: false,
    allow_handoff: false,
    allow_recommendation: false,
    offered_cards: [],
  },
  catalog: {
    routine_items: [],
    assessments: [],
    psikologs: [],
    directory: [],
  },
};

function client(fetchImpl: typeof fetch, env: Record<string, unknown> = {}) {
  return new AgentClient(
    testConfig({ AGENT_URL: 'http://agent.local/', ...env }),
    fetchImpl,
  );
}

describe('AgentClient', () => {
  it('parses events split across arbitrary chunk boundaries', async () => {
    const fetchImpl = jest.fn(() =>
      Promise.resolve(
        sseResponse([
          'event: safety\ndata: {"level":"normal","signals":[]}\n\nevent: token\ndata: {"delta":"Ha',
          'lo "}\n\n: ping\n\nevent: token\ndata: {"delta":"juga"}\n\nevent: structured\ndata: {"type":"routine","data":{"topic":"rokok"}}\n\nevent: future\ndata: {}\n\n',
          'event: done\ndata: {"content":"Halo juga","model":"m","prompt_version":"p","replaced":false}\n\n',
        ]),
      ),
    ) as unknown as typeof fetch;

    await expect(
      collect(client(fetchImpl).streamTurn(request)),
    ).resolves.toEqual([
      { event: 'safety', level: 'normal', signals: [], timed_out: false },
      { event: 'token', delta: 'Halo ' },
      { event: 'token', delta: 'juga' },
      { event: 'structured', type: 'routine', data: { topic: 'rokok' } },
      { event: 'other', name: 'future' },
      {
        event: 'done',
        content: 'Halo juga',
        model: 'm',
        prompt_version: 'p',
        replaced: false,
        aborted: false,
        // An agent that reports no usage yields zeros, never NaN or undefined.
        usage: { input_tokens: 0, output_tokens: 0, cached_tokens: 0 },
      },
    ]);
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://agent.local/v1/turn',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(request),
      }),
    );
  });

  it('passes agent error events through', async () => {
    const fetchImpl = (() =>
      Promise.resolve(
        sseResponse(['event: error\ndata: {"code":"MODEL_ERROR"}\n\n']),
      )) as unknown as typeof fetch;

    await expect(
      collect(client(fetchImpl).streamTurn(request)),
    ).resolves.toEqual([{ event: 'error', code: 'MODEL_ERROR' }]);
  });

  it.each([
    ['a non-2xx answer', () => Promise.resolve(sseResponse([], 503))],
    ['a network failure', () => Promise.reject(new TypeError('fetch failed'))],
  ])('reports %s as AgentUnavailableError', async (_case, impl) => {
    await expect(
      collect(client(impl as unknown as typeof fetch).streamTurn(request)),
    ).rejects.toBeInstanceOf(AgentUnavailableError);
  });

  it('names a 200 answer that is not an event stream', async () => {
    const fetchImpl = (() =>
      Promise.resolve(
        new Response('{"status":"ok"}', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )) as unknown as typeof fetch;

    await expect(
      collect(client(fetchImpl).streamTurn(request)),
    ).rejects.toMatchObject({ status: 200, code: 'NOT_EVENT_STREAM' });
  });

  it('rejects a summary answer without a summary', async () => {
    const fetchImpl = (() =>
      Promise.resolve(
        new Response('{"status":"ok"}', { status: 200 }),
      )) as unknown as typeof fetch;

    await expect(
      client(fetchImpl).summarize({ history: [] }),
    ).rejects.toMatchObject({ code: 'BAD_RESPONSE' });
  });

  it('rejects malformed events', async () => {
    const fetchImpl = (() =>
      Promise.resolve(
        sseResponse(['event: done\ndata: {"content":1}\n\n']),
      )) as unknown as typeof fetch;

    await expect(
      collect(client(fetchImpl).streamTurn(request)),
    ).rejects.toThrow('Malformed agent event');
  });

  it('rejects a safety event with an unknown level', async () => {
    const fetchImpl = (() =>
      Promise.resolve(
        sseResponse(['event: safety\ndata: {"level":"fine"}\n\n']),
      )) as unknown as typeof fetch;

    await expect(
      collect(client(fetchImpl).streamTurn(request)),
    ).rejects.toThrow('Malformed agent event');
  });

  it('posts JSON to the router endpoint', async () => {
    const fetchImpl = jest.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            persona_id: 'p',
            reason: 'r',
            initial_risk: 'normal',
            topics: [],
          }),
          { status: 200 },
        ),
      ),
    ) as unknown as typeof fetch;

    await expect(
      client(fetchImpl).routerSelect({
        message: 'hai',
        locale: 'en',
        personas: [],
      }),
    ).resolves.toMatchObject({ persona_id: 'p' });
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://agent.local/v1/router/select',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ message: 'hai', locale: 'en', personas: [] }),
      }),
    );
  });

  it('ends a silent stream with TIMEOUT_IDLE', async () => {
    const fetchImpl = timedFetch([
      [0, SAFETY_SSE],
      [500, DONE_SSE],
    ]);

    const result = await failureCode(
      client(fetchImpl, {
        AGENT_IDLE_TIMEOUT_MS: '60',
      }).streamTurn(request),
    );

    expect(result).toEqual({ seen: ['safety'], code: 'TIMEOUT_IDLE' });
  });

  it('ends a turn past its deadline with TIMEOUT_TOTAL, pings notwithstanding', async () => {
    const fetchImpl = timedFetch([
      [0, SAFETY_SSE],
      [40, ': ping\n\n'],
      [40, ': ping\n\n'],
      [40, ': ping\n\n'],
      [400, DONE_SSE],
    ]);

    const result = await failureCode(
      client(fetchImpl, {
        AGENT_TURN_TIMEOUT_MS: '100',
        AGENT_IDLE_TIMEOUT_MS: '1000',
      }).streamTurn(request),
    );

    expect(result).toEqual({ seen: ['safety'], code: 'TIMEOUT_TOTAL' });
  });

  it('gives cards after done only a short grace, whatever the turn deadline', async () => {
    const fetchImpl = timedFetch([
      [0, SAFETY_SSE + DONE_SSE],
      [400, 'event: structured\ndata: {"type":"routine","data":{}}\n\n'],
    ]);

    const result = await failureCode(
      client(fetchImpl, {
        AGENT_TURN_TIMEOUT_MS: '5000',
        AGENT_CARDS_GRACE_MS: '50',
      }).streamTurn(request),
    );

    expect(result).toEqual({ seen: ['safety', 'done'], code: 'TIMEOUT_TOTAL' });
  });

  it('starts the clock only after the ID token is in hand', async () => {
    const fetchImpl = timedFetch([[0, SAFETY_SSE + DONE_SSE]], true);
    const agent = client(fetchImpl, { AGENT_TURN_TIMEOUT_MS: '50' });
    const slowAuth = jest
      .spyOn(
        agent as unknown as { authHeaders: () => Promise<object> },
        'authHeaders',
      )
      .mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({}), 120)),
      );

    await expect(collect(agent.streamTurn(request))).resolves.toHaveLength(2);
    slowAuth.mockRestore();
  });

  it('gives the router its own short timeout', async () => {
    const fetchImpl = jest.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(new DOMException('timed out', 'TimeoutError')),
          );
        }),
    ) as unknown as typeof fetch;

    await expect(
      client(fetchImpl, { ROUTER_TIMEOUT_MS: '30' }).routerSelect({
        message: 'x',
        personas: [],
      }),
    ).rejects.toMatchObject({ code: 'TIMEOUT_TOTAL' });
  });

  it('is unavailable without AGENT_URL', async () => {
    const fetchImpl = jest.fn() as unknown as typeof fetch;

    await expect(
      collect(client(fetchImpl, { AGENT_URL: '' }).streamTurn(request)),
    ).rejects.toBeInstanceOf(AgentUnavailableError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
