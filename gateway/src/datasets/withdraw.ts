import type { Prisma } from '../generated/prisma/client';

/**
 * Withdraws dataset items (consent revoked, account deleted). Items never exported are deleted;
 * exported ones lose their content and stay as `withdrawn` so the audit trail still shows they
 * were used — data already in a trained model cannot always be removed (Konsep §7.2).
 */
export async function withdrawItems(
  tx: Prisma.TransactionClient,
  where: Prisma.ai_dataset_itemsWhereInput,
): Promise<{ deleted: number; withdrawn: number }> {
  const deleted = await tx.ai_dataset_items.deleteMany({
    where: { ...where, last_exported_at: null },
  });
  const withdrawn = await tx.ai_dataset_items.updateMany({
    where: { ...where, last_exported_at: { not: null } },
    data: { status: 'withdrawn', content_ciphertext: null },
  });
  return { deleted: deleted.count, withdrawn: withdrawn.count };
}
