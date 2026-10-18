import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AiAuthGuard, type AiRequest } from './ai-auth.guard';
import type { AiRole } from './ai-principal';
import { AiTokenVerifier } from './ai-token-verifier.service';
import { testConfig } from '../config/testing';
import { createTestIssuer, type TestIssuer } from './testing';

function contextFor(request: Partial<AiRequest>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
}

describe('AiAuthGuard', () => {
  let issuer: TestIssuer;
  let verifier: AiTokenVerifier;

  beforeAll(async () => {
    issuer = await createTestIssuer();
    verifier = new AiTokenVerifier(issuer.jwks, testConfig());
  });

  function guard(roles?: AiRole[]): AiAuthGuard {
    const reflector = {
      getAllAndOverride: () => roles,
    } as unknown as Reflector;
    return new AiAuthGuard(verifier, reflector);
  }

  it('attaches the principal for a valid bearer token', async () => {
    const request: Partial<AiRequest> = {
      headers: { authorization: `Bearer ${await issuer.sign({ sub: 'u1' })}` },
    };

    await expect(guard().canActivate(contextFor(request))).resolves.toBe(true);
    expect(request.aiPrincipal).toMatchObject({ sub: 'u1', role: 'user' });
  });

  it('rejects a missing bearer token', async () => {
    await expect(
      guard().canActivate(contextFor({ headers: {} })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('enforces route roles', async () => {
    const request: Partial<AiRequest> = {
      headers: {
        authorization: `Bearer ${await issuer.sign({ role: 'psikolog' })}`,
      },
    };

    await expect(
      guard(['user']).canActivate(contextFor(request)),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
