import { testConfig } from '../config/testing';
import type { RedisService } from '../redis/redis.service';
import { V3Client } from './v3-client.service';

/** In-memory stand-in for the JSON helpers V3Client uses. */
function memoryRedis() {
  const store = new Map<string, unknown>();
  return {
    store,
    getJson: jest.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
    setJson: jest.fn((key: string, value: unknown) => {
      store.set(key, value);
      return Promise.resolve();
    }),
    exists: jest.fn((key: string) => Promise.resolve(store.has(key))),
  };
}

const PAGE = {
  items: [
    {
      psikolog_id: 'psy-1',
      psikolog: { name: 'Contoh', specialists: [{ name: 'Kecemasan' }] },
    },
  ],
  meta: { last_page: 1 },
};

describe('V3Client.psikologDirectory', () => {
  let redis: ReturnType<typeof memoryRedis>;

  beforeEach(() => {
    redis = memoryRedis();
  });

  const client = (fetchImpl: typeof fetch) =>
    new V3Client(
      testConfig({ DEEPTALK_API_URL: 'http://v3.local' }),
      redis as unknown as RedisService,
      fetchImpl,
    );

  it('loads a cold directory once for concurrent turns', async () => {
    const fetchImpl = jest.fn(
      () =>
        new Promise<Response>((resolve) =>
          setTimeout(
            () => resolve(Response.json({ data: PAGE }, { status: 200 })),
            20,
          ),
        ),
    ) as unknown as typeof fetch;
    const v3 = client(fetchImpl);

    const results = await Promise.all([
      v3.psikologDirectory(),
      v3.psikologDirectory(),
      v3.psikologDirectory(),
    ]);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(new Set(results.map((list) => list.length)).size).toBe(1);
  });

  it('skips the directory for a while after it failed, instead of waiting again', async () => {
    const fetchImpl = jest.fn(() =>
      Promise.resolve(new Response('down', { status: 502 })),
    ) as unknown as typeof fetch;
    const v3 = client(fetchImpl);

    await expect(v3.psikologDirectory()).rejects.toThrow();
    await expect(v3.psikologDirectory()).resolves.toEqual([]);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(redis.setJson).toHaveBeenCalledWith(
      'v3:psikolog-directory:failed',
      { failed: true },
      30,
    );
  });
});
