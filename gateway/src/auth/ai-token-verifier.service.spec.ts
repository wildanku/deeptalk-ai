import {
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { SignJWT } from 'jose';
import { AiTokenVerifier } from './ai-token-verifier.service';
import { testConfig } from '../config/testing';
import { createTestIssuer, type TestIssuer } from './testing';

const config = testConfig();

describe('AiTokenVerifier', () => {
  let issuer: TestIssuer;
  let verifier: AiTokenVerifier;

  beforeAll(async () => {
    issuer = await createTestIssuer();
    verifier = new AiTokenVerifier(issuer.jwks, config);
  });

  it('accepts a valid token and returns the principal', async () => {
    const principal = await verifier.verify(
      await issuer.sign({ sub: 'u-42', role: 'user' }),
    );

    expect(principal).toMatchObject({ sub: 'u-42', role: 'user' });
    expect(typeof principal.jti).toBe('string');
    expect(principal.exp).toBeGreaterThan(Date.now() / 1000);
  });

  it.each([
    ['a wrong audience', { audience: 'deeptalk-chat' }],
    ['a wrong issuer', { issuer: 'someone-else' }],
    ['an unknown kid', { kid: 'rotated-away' }],
    ['an expired token', { expiresIn: Math.floor(Date.now() / 1000) - 60 }],
  ])('rejects %s', async (_case, options) => {
    await expect(
      verifier.verify(await issuer.sign({}, options)),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects an unknown role and a token without role', async () => {
    await expect(
      verifier.verify(await issuer.sign({ role: 'admin' })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      verifier.verify(await issuer.sign({ role: undefined })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects HS256 tokens even with a matching kid', async () => {
    const hs = await new SignJWT({ role: 'user' })
      .setProtectedHeader({ alg: 'HS256', kid: 'test-kid' })
      .setSubject('u')
      .setJti('j')
      .setIssuedAt()
      .setIssuer('deeptalk-api')
      .setAudience('deeptalk-ai')
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode('s'.repeat(32)));

    await expect(verifier.verify(hs)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects garbage', async () => {
    await expect(verifier.verify('not.a.jwt')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('fails closed when no JWKS is configured', async () => {
    const unconfigured = new AiTokenVerifier(null, config);

    await expect(
      unconfigured.verify(await issuer.sign()),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('refuses a still-valid token of a deleted account (tombstone)', async () => {
    const redis = {
      exists: jest.fn((key: string) =>
        Promise.resolve(key === 'account-gone:u-gone'),
      ),
    };
    const guarded = new AiTokenVerifier(issuer.jwks, config, redis as never);
    await expect(
      guarded.verify(await issuer.sign({ sub: 'u-gone', role: 'user' })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      guarded.verify(await issuer.sign({ sub: 'u-live', role: 'user' })),
    ).resolves.toMatchObject({ sub: 'u-live' });
  });

  it('does not lock everyone out when the tombstone check fails', async () => {
    const redis = { exists: jest.fn(() => Promise.reject(new Error('down'))) };
    const guarded = new AiTokenVerifier(issuer.jwks, config, redis as never);
    await expect(
      guarded.verify(await issuer.sign({ sub: 'u-1', role: 'user' })),
    ).resolves.toMatchObject({ sub: 'u-1' });
  });
});
