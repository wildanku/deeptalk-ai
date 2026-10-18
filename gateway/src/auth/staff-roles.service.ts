import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import type { AiStaffRole } from '../generated/prisma/client';

export type PsikologRole = 'psikolog' | AiStaffRole;

/**
 * Roles beyond the token's `psikolog` (02 §10.2). v3 only says *who* the psikolog is; what
 * they may curate is decided here, in `ai_staff_roles` (`pnpm run roles:grant`).
 */
@Injectable()
export class StaffRolesService {
  constructor(private readonly prisma: PrismaService) {}

  async roles(psychologistId: string): Promise<PsikologRole[]> {
    const rows = await this.prisma.ai_staff_roles.findMany({
      where: { psychologist_id: psychologistId },
      select: { role: true },
    });
    return ['psikolog', ...rows.map((row) => row.role)];
  }

  async has(psychologistId: string, role: AiStaffRole): Promise<boolean> {
    const row = await this.prisma.ai_staff_roles.findUnique({
      where: {
        psychologist_id_role: { psychologist_id: psychologistId, role },
      },
    });
    return row !== null;
  }
}
