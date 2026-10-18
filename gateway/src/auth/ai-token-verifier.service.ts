import {
  Inject,
  Injectable,
  Logger,
  Optional,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type JWTVerifyGetKey, jwtVerify } from 'jose';
import type { Environment } from '../config/env.schema';
import { RedisService } from '../redis/redis.service';
import type { AiPrincipal, AiRole } from './ai-principal';

/**
 * Set when v3 deletes or merges away an account. A token issued before that stays valid for up
 * to 15 minutes; without this, it could still write rows for a user who no longer exists.
 */
export const accountGoneKey = (userId: string): string =>
  `account-gone:${userId}`;
/** Longer than any AI token can live (TTL 15 min + clock skew). */
export const ACCOUNT_GONE_TTL_SECONDS = 3_600;

/** Key resolver for verification; `null` when `AI_JWKS_URL` is unset (fail closed). */
export const AI_JWKS = Symbol('AI_JWKS');

const ROLES: readonly AiRole[] = ['user', 'psikolog'];
// Small clock skew allowance between v3 and the gateway.
const CLOCK_TOLERANCE_SECONDS = 5;

@Injectable()
export class AiTokenVerifier {
  private readonly logger = new Logger(AiTokenVerifier.name);
  private readonly issuer: string;
  private readonly audience: string;

  constructor(
    @Inject(AI_JWKS) private readonly keys: JWTVerifyGetKey | null,
    config: ConfigService<Environment, true>,
    @Optional() private readonly redis?: RedisService,
  ) {
    this.issuer = config.get('AI_JWT_ISSUER', { infer: true });
    this.audience = config.get('AI_JWT_AUDIENCE', { infer: true });
  }

  /**
   * Accepts only ES256 tokens from v3 for this audience, signed by a key in the JWKS
   * (unknown `kid` → rejected). Any failure is a 401 with no detail about which check failed.
   */
  async verify(token: string): Promise<AiPrincipal> {
    if (!this.keys) {
      throw new ServiceUnavailableException({
        code: 'AI_AUTH_NOT_CONFIGURED',
        message: 'Authentication is not configured',
      });
    }
    let principal: AiPrincipal;
    try {
      const { payload } = await jwtVerify(token, this.keys, {
        algorithms: ['ES256'],
        issuer: this.issuer,
        audience: this.audience,
        requiredClaims: ['sub', 'jti', 'exp', 'iat'],
        clockTolerance: CLOCK_TOLERANCE_SECONDS,
      });
      const role = payload.role;
      if (
        typeof payload.sub !== 'string' ||
        typeof payload.jti !== 'string' ||
        typeof payload.exp !== 'number' ||
        typeof role !== 'string' ||
        !ROLES.includes(role as AiRole)
      ) {
        throw new Error('Malformed claims');
      }
      principal = {
        sub: payload.sub,
        role: role as AiRole,
        jti: payload.jti,
        exp: payload.exp,
      };
    } catch {
      throw new UnauthorizedException({
        code: 'AI_TOKEN_INVALID',
        message: 'The AI access token is invalid or expired',
      });
    }
    if (principal.role === 'user' && (await this.accountGone(principal.sub))) {
      throw new UnauthorizedException({
        code: 'AI_TOKEN_INVALID',
        message: 'The AI access token is invalid or expired',
      });
    }
    return principal;
  }

  private async accountGone(userId: string): Promise<boolean> {
    if (!this.redis) return false;
    try {
      return await this.redis.exists(accountGoneKey(userId));
    } catch {
      // Redis down already stops conversations; do not also lock everyone out of REST.
      this.logger.warn('Account tombstone check unavailable');
      return false;
    }
  }
}
