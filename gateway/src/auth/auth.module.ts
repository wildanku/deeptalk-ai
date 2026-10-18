import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createRemoteJWKSet } from 'jose';
import type { Environment } from '../config/env.schema';
import { AiAuthGuard } from './ai-auth.guard';
import { AI_JWKS, AiTokenVerifier } from './ai-token-verifier.service';
import { StaffRoleGuard } from './staff-role.guard';
import { StaffRolesService } from './staff-roles.service';

/**
 * Verifies AI access tokens issued by deeptalk-api-v3 (ES256, 02 §5.2) against its JWKS.
 * The gateway never holds a key that can mint tokens. JWKS is cached 5 minutes (same as v3's
 * `Cache-Control`); an unknown `kid` triggers a refetch, rate-limited by the cooldown.
 */
@Global()
@Module({
  providers: [
    {
      provide: AI_JWKS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Environment, true>) => {
        const url = config.get('AI_JWKS_URL', { infer: true });
        return url
          ? createRemoteJWKSet(new URL(url), {
              cacheMaxAge: 5 * 60_000,
              cooldownDuration: 30_000,
              timeoutDuration: 5_000,
            })
          : null;
      },
    },
    AiTokenVerifier,
    AiAuthGuard,
    StaffRolesService,
    StaffRoleGuard,
  ],
  exports: [AiTokenVerifier, AiAuthGuard, StaffRolesService, StaffRoleGuard],
})
export class AuthModule {}
