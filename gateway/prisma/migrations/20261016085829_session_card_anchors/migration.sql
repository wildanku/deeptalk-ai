-- AlterTable
ALTER TABLE "ai_psikolog_recommendations" ADD COLUMN     "card_ciphertext" BYTEA,
ADD COLUMN     "message_id" UUID;

-- AlterTable
ALTER TABLE "ai_routine_proposals" ADD COLUMN     "message_id" UUID;

-- CreateIndex
CREATE INDEX "ai_routine_proposals_session_id_idx" ON "ai_routine_proposals"("session_id");
