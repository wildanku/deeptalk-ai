import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  type JWTVerifyGetKey,
  SignJWT,
} from 'jose';
import { randomUUID } from 'node:crypto';

/** Test-only stand-in for deeptalk-api-v3's token issuer. */
export interface TestIssuer {
  jwks: JWTVerifyGetKey;
  sign(
    claims?: Record<string, unknown>,
    options?: {
      kid?: string;
      expiresIn?: string | number;
      audience?: string;
      issuer?: string;
    },
  ): Promise<string>;
}

export async function createTestIssuer(kid = 'test-kid'): Promise<TestIssuer> {
  const { publicKey, privateKey } = await generateKeyPair('ES256', {
    extractable: true,
  });
  const jwk = { ...(await exportJWK(publicKey)), kid, alg: 'ES256' };
  return {
    jwks: createLocalJWKSet({ keys: [jwk] }),
    sign: (claims = {}, options = {}) =>
      new SignJWT({ role: 'user', ...claims })
        .setProtectedHeader({ alg: 'ES256', kid: options.kid ?? kid })
        .setSubject((claims.sub as string | undefined) ?? 'user-1')
        .setJti(randomUUID())
        .setIssuedAt()
        .setIssuer(options.issuer ?? 'deeptalk-api')
        .setAudience(options.audience ?? 'deeptalk-ai')
        .setExpirationTime(options.expiresIn ?? '15m')
        .sign(privateKey),
  };
}
