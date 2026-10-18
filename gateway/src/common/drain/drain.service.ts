import { Injectable } from '@nestjs/common';

/**
 * Tracks in-flight work (conversation turns) so shutdown can let it finish before the
 * database and Redis clients close. Cloud Run sends SIGTERM on deploy and allows ~10 s.
 */
@Injectable()
export class DrainService {
  private readonly inflight = new Set<Promise<unknown>>();
  private drained: Promise<void> | null = null;

  track<T>(work: Promise<T>): Promise<T> {
    this.inflight.add(work);
    void work.finally(() => this.inflight.delete(work)).catch(() => undefined);
    return work;
  }

  get size(): number {
    return this.inflight.size;
  }

  /** Waits for tracked work, at most `timeoutMs`. Idempotent: every caller shares one wait. */
  drain(timeoutMs = 8_000): Promise<void> {
    this.drained ??= Promise.race([
      Promise.allSettled([...this.inflight]).then(() => undefined),
      new Promise<void>((resolve) => setTimeout(resolve, timeoutMs).unref()),
    ]);
    return this.drained;
  }
}
