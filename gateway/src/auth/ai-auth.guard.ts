import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { AiPrincipal, AiRole } from './ai-principal';
import { AiTokenVerifier } from './ai-token-verifier.service';
import { extractBearer } from './bearer';

export interface AiRequest extends Request {
  aiPrincipal?: AiPrincipal;
}

const AI_ROLES_KEY = 'aiRoles';

/** Restricts a route to the given token roles (default: any verified role). */
export const AiRoles = (...roles: AiRole[]) => SetMetadata(AI_ROLES_KEY, roles);

export const CurrentPrincipal = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AiPrincipal => {
    const principal = context
      .switchToHttp()
      .getRequest<AiRequest>().aiPrincipal;
    if (!principal) throw new UnauthorizedException();
    return principal;
  },
);

/** REST counterpart of the socket handshake check: `Authorization: Bearer <ai_access_token>`. */
@Injectable()
export class AiAuthGuard implements CanActivate {
  constructor(
    private readonly verifier: AiTokenVerifier,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AiRequest>();
    const token = extractBearer(request.headers.authorization);
    if (!token) {
      throw new UnauthorizedException({
        code: 'AI_TOKEN_MISSING',
        message: 'No bearer token provided',
      });
    }
    const principal = await this.verifier.verify(token);
    const roles = this.reflector.getAllAndOverride<AiRole[] | undefined>(
      AI_ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (roles && !roles.includes(principal.role)) {
      throw new ForbiddenException({
        code: 'AI_ROLE_FORBIDDEN',
        message: 'This token cannot access this resource',
      });
    }
    request.aiPrincipal = principal;
    return true;
  }
}
