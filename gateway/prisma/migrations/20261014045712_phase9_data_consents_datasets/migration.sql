-- CreateEnum
CREATE TYPE "AiDataGate" AS ENUM ('dpia', 'ethics_review', 'fine_tuning_go');

-- CreateEnum
CREATE TYPE "AiDatasetSource" AS ENUM ('teman_ai', 'legacy');

-- CreateEnum
CREATE TYPE "AiDatasetItemStatus" AS ENUM ('pending_review', 'approved', 'rejected', 'withdrawn');

-- CreateEnum
CREATE TYPE "AiDatasetPurpose" AS ENUM ('evaluation', 'style_examples', 'fine_tuning');

-- AlterEnum
ALTER TYPE "AiConsentType" ADD VALUE 'legacy_counseling';

-- AlterEnum
ALTER TYPE "AiStaffRole" ADD VALUE 'data_reviewer';

-- CreateTable
CREATE TABLE "ai_psikolog_data_consents" (
    "id" UUID NOT NULL,
    "psychologist_id" VARCHAR(255) NOT NULL,
    "text_version" INTEGER NOT NULL,
    "allow_evaluation" BOOLEAN NOT NULL,
    "allow_style_examples" BOOLEAN NOT NULL,
    "allow_training" BOOLEAN NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_psikolog_data_consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_data_gates" (
    "id" UUID NOT NULL,
    "gate" "AiDataGate" NOT NULL,
    "approved" BOOLEAN NOT NULL,
    "recorded_by" VARCHAR(255) NOT NULL,
    "reference" VARCHAR(500) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_data_gates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_dataset_items" (
    "id" UUID NOT NULL,
    "source" "AiDatasetSource" NOT NULL,
    "source_ref" VARCHAR(255) NOT NULL,
    "user_id" VARCHAR(255) NOT NULL,
    "psychologist_id" VARCHAR(255),
    "persona_id" VARCHAR(64),
    "turns" INTEGER NOT NULL,
    "content_ciphertext" BYTEA,
    "deid_provider" VARCHAR(32) NOT NULL,
    "deid_findings" JSONB NOT NULL DEFAULT '{}',
    "status" "AiDatasetItemStatus" NOT NULL DEFAULT 'pending_review',
    "reviewed_by" VARCHAR(255),
    "reviewed_at" TIMESTAMPTZ(3),
    "review_notes" VARCHAR(2000),
    "used_for" "AiDatasetPurpose"[] DEFAULT ARRAY[]::"AiDatasetPurpose"[],
    "last_exported_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ai_dataset_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_dataset_exports" (
    "id" UUID NOT NULL,
    "purpose" "AiDatasetPurpose" NOT NULL,
    "item_count" INTEGER NOT NULL,
    "exported_by" VARCHAR(255) NOT NULL,
    "manifest" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_dataset_exports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_psikolog_data_consents_psychologist_id_created_at_idx" ON "ai_psikolog_data_consents"("psychologist_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_data_gates_gate_created_at_idx" ON "ai_data_gates"("gate", "created_at");

-- CreateIndex
CREATE INDEX "ai_dataset_items_status_created_at_idx" ON "ai_dataset_items"("status", "created_at");

-- CreateIndex
CREATE INDEX "ai_dataset_items_user_id_idx" ON "ai_dataset_items"("user_id");

-- CreateIndex
CREATE INDEX "ai_dataset_items_psychologist_id_idx" ON "ai_dataset_items"("psychologist_id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_dataset_items_source_source_ref_key" ON "ai_dataset_items"("source", "source_ref");
