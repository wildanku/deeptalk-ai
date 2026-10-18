import { DrainService } from './drain.service';

describe('DrainService', () => {
  it('waits for tracked work before resolving', async () => {
    const drain = new DrainService();
    let finished = false;
    void drain.track(
      new Promise<void>((resolve) =>
        setTimeout(() => {
          finished = true;
          resolve();
        }, 20),
      ),
    );

    await drain.drain(1_000);

    expect(finished).toBe(true);
    expect(drain.size).toBe(0);
  });

  it('gives up after the timeout', async () => {
    const drain = new DrainService();
    void drain.track(new Promise(() => undefined));

    const started = Date.now();
    await drain.drain(30);

    expect(Date.now() - started).toBeLessThan(500);
  });

  it('does not reject when tracked work fails', async () => {
    const drain = new DrainService();
    void drain.track(Promise.reject(new Error('x'))).catch(() => undefined);

    await expect(drain.drain(100)).resolves.toBeUndefined();
  });
});
