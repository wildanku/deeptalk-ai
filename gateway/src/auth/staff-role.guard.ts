import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AiStaffRole } from '../generated/prisma/client';
import type { AiRequest } from './ai-auth.guard';
import { StaffRolesService } from './staff-roles.service';

const STAFF_ROLE_KEY = 'aiStaffRole';

/** Requires a psikolog token *and* a staff role in `ai_staff_roles`. Use after `AiAuthGuard`. */
export const RequireStaffRole = (role: AiStaffRole) =>
  SetMetadata(STAFF_ROLE_KEY, role);

@Injectable()
export class StaffRoleGuard implements CanActivate {
  constructor(
    private readonly roles: StaffRolesService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const role = this.reflector.getAllAndOverride<AiStaffRole | undefined>(
      STAFF_ROLE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!role) return true;
    const principal = context
      .switchToHttp()
      .getRequest<AiRequest>().aiPrincipal;
    if (!principal) throw new UnauthorizedException();
    if (
      principal.role !== 'psikolog' ||
      !(await this.roles.has(principal.sub, role))
    ) {
      throw new ForbiddenException({
        code: 'AI_STAFF_ROLE_REQUIRED',
        message: 'Akses ini khusus reviewer klinis',
      });
    }
    return true;
  }
}
