import type { DataKeyProvider } from './key-provider';

const MARKER = Buffer.from('local:v1', 'utf8');

/**
 * Development only (`MESSAGE_LOCAL_KEY`, rejected in production by env validation): the
 * configured key is used directly as the data key.
 */
export class LocalKeyProvider implements DataKeyProvider {
  constructor(private readonly key: Buffer) {
    if (key.length !== 32)
      throw new Error('Local message key must be 32 bytes');
  }

  current(): Promise<{ dek: Buffer; wrapped: Buffer }> {
    return Promise.resolve({ dek: this.key, wrapped: MARKER });
  }

  unwrap(wrapped: Buffer): Promise<Buffer> {
    if (!wrapped.equals(MARKER)) {
      return Promise.reject(
        new Error('Ciphertext was not sealed with the local key'),
      );
    }
    return Promise.resolve(this.key);
  }
}
