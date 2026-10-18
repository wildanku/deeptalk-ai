/** Supplies data keys for envelope encryption and unwraps them again for decryption. */
export interface DataKeyProvider {
  /** Current data key and its wrapped form (stored alongside every ciphertext). */
  current(): Promise<{ dek: Buffer; wrapped: Buffer }>;
  unwrap(wrapped: Buffer): Promise<Buffer>;
}

export const DATA_KEY_PROVIDER = Symbol('DATA_KEY_PROVIDER');
