import { createHash, randomBytes } from 'node:crypto';
import type { DataKeyProvider } from './key-provider';

/** The subset of `KeyManagementServiceClient` used here (keeps tests free of GCP). */
export interface KmsClient {
  encrypt(request: {
    name: string;
    plaintext: Buffer;
  }): Promise<[{ ciphertext?: Uint8Array | string | null }, ...unknown[]]>;
  decrypt(request: {
    name: string;
    ciphertext: Buffer;
  }): Promise<[{ plaintext?: Uint8Array | string | null }, ...unknown[]]>;
}

export interface KmsKeyProviderOptions {
  /** Generate a fresh data key after this long (default 24 h). */
  rotateAfterMs?: number;
  /** Unwrapped keys kept in memory for decryption (default 1000). */
  cacheSize?: number;
  now?: () => number;
}

/**
 * Envelope encryption with Cloud KMS (02 §9.1): each instance generates a random AES-256 data
 * key, wraps it once with the KMS key (`MESSAGE_KMS_KEY`), and reuses it until rotation — so
 * KMS is called once per data key, not once per message. Rotating the KMS key itself needs no
 * re-encryption: KMS keeps old key versions able to unwrap.
 */
export class KmsKeyProvider implements DataKeyProvider {
  private active: { dek: Buffer; wrapped: Buffer; createdAt: number } | null =
    null;
  private creating: Promise<{ dek: Buffer; wrapped: Buffer }> | null = null;
  private readonly cache = new Map<string, Buffer>();
  /** Unwraps in flight: a cold instance decrypting a page of history makes one KMS call per key. */
  private readonly unwrapping = new Map<string, Promise<Buffer>>();
  private readonly rotateAfterMs: number;
  private readonly cacheSize: number;
  private readonly now: () => number;

  constructor(
    private readonly kms: KmsClient,
    private readonly keyName: string,
    options: KmsKeyProviderOptions = {},
  ) {
    this.rotateAfterMs = options.rotateAfterMs ?? 24 * 60 * 60_000;
    this.cacheSize = options.cacheSize ?? 1000;
    this.now = options.now ?? Date.now;
  }

  async current(): Promise<{ dek: Buffer; wrapped: Buffer }> {
    if (
      this.active &&
      this.now() - this.active.createdAt < this.rotateAfterMs
    ) {
      return this.active;
    }
    // Concurrent callers share one KMS round trip.
    this.creating ??= this.createDataKey().finally(() => {
      this.creating = null;
    });
    return this.creating;
  }

  async unwrap(wrapped: Buffer): Promise<Buffer> {
    const id = createHash('sha256').update(wrapped).digest('hex');
    const cached = this.cache.get(id);
    if (cached) {
      // Refresh recency (Map keeps insertion order → simple LRU).
      this.cache.delete(id);
      this.cache.set(id, cached);
      return cached;
    }
    const running = this.unwrapping.get(id);
    if (running) return running;
    const unwrapping = (async () => {
      const [response] = await this.kms.decrypt({
        name: this.keyName,
        ciphertext: wrapped,
      });
      const dek = toBuffer(response.plaintext);
      if (dek.length !== 32)
        throw new Error('KMS returned an invalid data key');
      this.remember(id, dek);
      return dek;
    })().finally(() => this.unwrapping.delete(id));
    this.unwrapping.set(id, unwrapping);
    return unwrapping;
  }

  private async createDataKey(): Promise<{ dek: Buffer; wrapped: Buffer }> {
    const dek = randomBytes(32);
    const [response] = await this.kms.encrypt({
      name: this.keyName,
      plaintext: dek,
    });
    const wrapped = toBuffer(response.ciphertext);
    this.active = { dek, wrapped, createdAt: this.now() };
    this.remember(createHash('sha256').update(wrapped).digest('hex'), dek);
    return this.active;
  }

  private remember(id: string, dek: Buffer): void {
    this.cache.set(id, dek);
    while (this.cache.size > this.cacheSize) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
  }
}

function toBuffer(value: Uint8Array | string | null | undefined): Buffer {
  if (value === null || value === undefined) {
    throw new Error('KMS returned no data');
  }
  return typeof value === 'string'
    ? Buffer.from(value, 'base64')
    : Buffer.from(value);
}
