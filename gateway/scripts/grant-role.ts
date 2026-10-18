/**
 * Grants or revokes a staff role (02 §10.2). Run by an engineer on request of the clinical
 * lead; every change is printed for the operations log.
 *
 *   DATABASE_URL=… pnpm run roles:grant <psychologist_id> clinical_reviewer|data_reviewer [--revoke] --by <who>
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, type AiStaffRole } from '../src/generated/prisma/client';

const ROLES: AiStaffRole[] = ['clinical_reviewer', 'data_reviewer'];

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const [psychologistId, role] = args;
  const byIndex = args.indexOf('--by');
  const by = byIndex >= 0 ? args[byIndex + 1] : undefined;
  if (!psychologistId || !ROLES.includes(role as AiStaffRole) || !by) {
    throw new Error('usage: roles:grant <psychologist_id> clinical_reviewer|data_reviewer [--revoke] --by <who>');
  }
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  try {
    if (args.includes('--revoke')) {
      await prisma.ai_staff_roles.deleteMany({
        where: { psychologist_id: psychologistId, role: role as AiStaffRole },
      });
      process.stdout.write(`revoked ${role} from ${psychologistId} (by ${by})\n`);
    } else {
      await prisma.ai_staff_roles.upsert({
        where: { psychologist_id_role: { psychologist_id: psychologistId, role: role as AiStaffRole } },
        create: { psychologist_id: psychologistId, role: role as AiStaffRole, granted_by: by },
        update: {},
      });
      process.stdout.write(`granted ${role} to ${psychologistId} (by ${by})\n`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
