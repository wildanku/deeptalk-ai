-- CreateEnum
CREATE TYPE "AiInstrumentPurpose" AS ENUM ('checkin', 'screening', 'personality');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AiContentKind" ADD VALUE 'topic';
ALTER TYPE "AiContentKind" ADD VALUE 'instrument';

-- AlterEnum
ALTER TYPE "AiSafetyLayer" ADD VALUE 'instrument';

-- CreateTable
CREATE TABLE "ai_instrument_responses" (
    "id" UUID NOT NULL,
    "user_id" VARCHAR(255) NOT NULL,
    "instrument_ref" VARCHAR(128) NOT NULL,
    "instrument_version" INTEGER NOT NULL,
    "purpose" "AiInstrumentPurpose" NOT NULL,
    "local_date" DATE NOT NULL,
    "result_ciphertext" BYTEA NOT NULL,
    "safety_level" "AiRiskLevel" NOT NULL DEFAULT 'normal',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ai_instrument_responses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_instrument_responses_user_id_purpose_local_date_idx" ON "ai_instrument_responses"("user_id", "purpose", "local_date");

-- CreateIndex
CREATE INDEX "ai_instrument_responses_created_at_idx" ON "ai_instrument_responses"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "ai_instrument_responses_user_id_instrument_ref_local_date_key" ON "ai_instrument_responses"("user_id", "instrument_ref", "local_date");
