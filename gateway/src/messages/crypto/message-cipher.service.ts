import { Inject, Injectable } from '@nestjs/common';
import { open, parse, seal } from './envelope';
import { DATA_KEY_PROVIDER, type DataKeyProvider } from './key-provider';

/**
 * Encrypts conversation content at the application layer (AES-256-GCM, 02 §9.1). `aad` must
 * be the owning row's ID, so a ciphertext only decrypts in the row it was written for.
 */
@Injectable()
export class MessageCipher {
  constructor(
    @Inject(DATA_KEY_PROVIDER) private readonly keys: DataKeyProvider,
  ) {}

  async encrypt(plaintext: string, aad: string): Promise<Buffer> {
    const { dek, wrapped } = await this.keys.current();
    return seal(plaintext, dek, wrapped, aad);
  }

  async decrypt(ciphertext: Uint8Array, aad: string): Promise<string> {
    const parsed = parse(Buffer.from(ciphertext));
    const dek = await this.keys.unwrap(parsed.wrappedDek);
    return open(parsed, dek, aad);
  }
}
