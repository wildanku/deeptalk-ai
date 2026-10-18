import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { KmsKeyProvider, type KmsClient } from './kms-key-provider';
import { LocalKeyProvider } from './local-key-provider';
import { MessageCipher } from './message-cipher.service';

/** In-memory KMS: wraps with a fixed AES key, counts calls. */
function fakeKms(): KmsClient & {
  calls: { encrypt: number; decrypt: number };
} {
  const kek = randomBytes(32);
  const calls = { encrypt: 0, decrypt: 0 };
  return {
    calls,
    encrypt({ plaintext }) {
      calls.encrypt += 1;
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', kek, iv);
      const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      return Promise.resolve([
        { ciphertext: Buffer.concat([iv, cipher.getAuthTag(), body]) },
      ]);
    },
    decrypt({ ciphertext }) {
      calls.decrypt += 1;
      const decipher = createDecipheriv(
        'aes-256-gcm',
        kek,
        ciphertext.subarray(0, 12),
      );
      decipher.setAuthTag(ciphertext.subarray(12, 28));
      const plaintext = Buffer.concat([
        decipher.update(ciphertext.subarray(28)),
        decipher.final(),
      ]);
      return Promise.resolve([{ plaintext }]);
    },
  };
}

const KEY_NAME = 'projects/p/locations/l/keyRings/r/cryptoKeys/k';

describe('MessageCipher', () => {
  describe.each([
    ['local key', () => new LocalKeyProvider(randomBytes(32))],
    ['KMS', () => new KmsKeyProvider(fakeKms(), KEY_NAME)],
  ])('with %s', (_name, provider) => {
    it('round-trips content without storing plaintext', async () => {
      const cipher = new MessageCipher(provider());
      const sealed = await cipher.encrypt('aku merasa cemas 😟', 'message-1');

      expect(sealed.toString('utf8')).not.toContain('cemas');
      await expect(cipher.decrypt(sealed, 'message-1')).resolves.toBe(
        'aku merasa cemas 😟',
      );
    });

    it('refuses to decrypt under another row ID', async () => {
      const cipher = new MessageCipher(provider());
      const sealed = await cipher.encrypt('rahasia', 'message-1');

      await expect(cipher.decrypt(sealed, 'message-2')).rejects.toThrow();
    });

    it('detects tampering', async () => {
      const cipher = new MessageCipher(provider());
      const sealed = await cipher.encrypt('rahasia', 'm');
      sealed[sealed.length - 1] ^= 0xff;

      await expect(cipher.decrypt(sealed, 'm')).rejects.toThrow();
    });
  });

  it('calls KMS once per data key, then decrypts from cache', async () => {
    const kms = fakeKms();
    const cipher = new MessageCipher(new KmsKeyProvider(kms, KEY_NAME));

    const sealed = await Promise.all(
      ['a', 'b', 'c'].map((text) => cipher.encrypt(text, text)),
    );
    for (const [index, text] of ['a', 'b', 'c'].entries()) {
      await expect(cipher.decrypt(sealed[index], text)).resolves.toBe(text);
    }
    expect(kms.calls).toEqual({ encrypt: 1, decrypt: 0 });
  });

  it('shares one KMS unwrap among concurrent decrypts on a cold instance', async () => {
    const kms = fakeKms();
    const writer = new MessageCipher(new KmsKeyProvider(kms, KEY_NAME));
    const texts = ['a', 'b', 'c', 'd'];
    const sealed = await Promise.all(
      texts.map((text) => writer.encrypt(text, text)),
    );

    const reader = new MessageCipher(new KmsKeyProvider(kms, KEY_NAME));
    await expect(
      Promise.all(texts.map((text, i) => reader.decrypt(sealed[i], text))),
    ).resolves.toEqual(texts);
    expect(kms.calls.decrypt).toBe(1);
  });

  it('rotates the data key and still decrypts older messages via KMS', async () => {
    const kms = fakeKms();
    let now = 0;
    const options = { rotateAfterMs: 1000, now: () => now };
    const writer = new MessageCipher(
      new KmsKeyProvider(kms, KEY_NAME, options),
    );
    const old = await writer.encrypt('lama', 'm1');
    now = 2000;
    await writer.encrypt('baru', 'm2');

    // A fresh instance has nothing cached and must unwrap through KMS.
    const reader = new MessageCipher(new KmsKeyProvider(kms, KEY_NAME));
    await expect(reader.decrypt(old, 'm1')).resolves.toBe('lama');
    expect(kms.calls).toEqual({ encrypt: 2, decrypt: 1 });
  });

  it('rejects ciphertext sealed with a different provider', async () => {
    const kmsSealed = await new MessageCipher(
      new KmsKeyProvider(fakeKms(), KEY_NAME),
    ).encrypt('x', 'm');

    await expect(
      new MessageCipher(new LocalKeyProvider(randomBytes(32))).decrypt(
        kmsSealed,
        'm',
      ),
    ).rejects.toThrow('local key');
  });
});
