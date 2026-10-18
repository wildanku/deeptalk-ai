import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { StaffRoleGuard } from './staff-role.guard';
import type { StaffRolesService } from './staff-roles.service';

const context = (principal: unknown) =>
  ({
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => ({ aiPrincipal: principal }) }),
  }) as unknown as ExecutionContext;

describe('StaffRoleGuard', () => {
  const roles = { has: jest.fn() };
  const reflector = new Reflector();
  jest
    .spyOn(reflector, 'getAllAndOverride')
    .mockReturnValue('clinical_reviewer');
  const guard = new StaffRoleGuard(
    roles as unknown as StaffRolesService,
    reflector,
  );

  it('admits a psikolog with the role', async () => {
    roles.has.mockResolvedValue(true);
    await expect(
      guard.canActivate(context({ sub: 'p1', role: 'psikolog' })),
    ).resolves.toBe(true);
  });

  it('refuses a psikolog without the role, and any user token', async () => {
    roles.has.mockResolvedValue(false);
    await expect(
      guard.canActivate(context({ sub: 'p1', role: 'psikolog' })),
    ).rejects.toMatchObject({ response: { code: 'AI_STAFF_ROLE_REQUIRED' } });
    roles.has.mockResolvedValue(true);
    await expect(
      guard.canActivate(context({ sub: 'u1', role: 'user' })),
    ).rejects.toMatchObject({ response: { code: 'AI_STAFF_ROLE_REQUIRED' } });
  });
});
