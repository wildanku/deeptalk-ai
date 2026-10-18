import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Ciphertext layout (version 1):
 *
 *   [0x01][wrapped-key length: u16 BE][wrapped data key][IV: 12][GCM tag: 16][ciphertext]
 *
 * The data key (DEK) is AES-256; `wrapped data key` is what the key provider needs to unwrap
 * it (a KMS ciphertext, or a fixed marker for the local development key). AAD binds each
 * ciphertext to its row (e.g. the message ID) so ciphertexts cannot be swapped between rows.
 */
const VERSION = 1;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const HEADER_LENGTH = 3;

export function seal(
  plaintext: string,
  dek: Buffer,
  wrappedDek: Buffer,
  aad: string,
): Buffer {
  if (wrappedDek.length > 0xffff) throw new Error('Wrapped key too long');
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', dek, iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const body = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const header = Buffer.alloc(HEADER_LENGTH);
  header.writeUInt8(VERSION, 0);
  header.writeUInt16BE(wrappedDek.length, 1);
  return Buffer.concat([header, wrappedDek, iv, cipher.getAuthTag(), body]);
}

export interface ParsedEnvelope {
  wrappedDek: Buffer;
  iv: Buffer;
  tag: Buffer;
  body: Buffer;
}

export function parse(envelope: Buffer): ParsedEnvelope {
  if (envelope.length < HEADER_LENGTH || envelope.readUInt8(0) !== VERSION) {
    throw new Error('Unsupported ciphertext version');
  }
  const keyLength = envelope.readUInt16BE(1);
  const ivStart = HEADER_LENGTH + keyLength;
  const tagStart = ivStart + IV_LENGTH;
  const bodyStart = tagStart + TAG_LENGTH;
  if (envelope.length < bodyStart) throw new Error('Truncated ciphertext');
  return {
    wrappedDek: envelope.subarray(HEADER_LENGTH, ivStart),
    iv: envelope.subarray(ivStart, tagStart),
    tag: envelope.subarray(tagStart, bodyStart),
    body: envelope.subarray(bodyStart),
  };
}

export function open(parsed: ParsedEnvelope, dek: Buffer, aad: string): string {
  const decipher = createDecipheriv('aes-256-gcm', dek, parsed.iv);
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(parsed.tag);
  return Buffer.concat([
    decipher.update(parsed.body),
    decipher.final(),
  ]).toString('utf8');
}
