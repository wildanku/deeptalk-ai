-- CreateEnum
CREATE TYPE "AiConsentType" AS ENUM ('service', 'ai_training');

-- CreateEnum
CREATE TYPE "AiStaffRole" AS ENUM ('clinical_reviewer');

-- CreateEnum
CREATE TYPE "AiEvalCaseUsage" AS ENUM ('few_shot', 'eval');

-- CreateEnum
CREATE TYPE "AiEvalRunStatus" AS ENUM ('queued', 'running', 'completed', 'failed');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AiContentKind" ADD VALUE 'consent_text';
ALTER TYPE "AiContentKind" ADD VALUE 'assessment_mapping';
ALTER TYPE "AiContentKind" ADD VALUE 'persona_questionnaire';
ALTER TYPE "AiContentKind" ADD VALUE 'case_study';

-- AlterEnum
ALTER TYPE "AiContentStatus" ADD VALUE 'rejected';

-- DropForeignKey
ALTER TABLE "ai_safety_events" DROP CONSTRAINT "ai_safety_events_session_id_fkey";

-- AlterTable
ALTER TABLE "ai_content_versions" ADD COLUMN     "review_notes" VARCHAR(2000),
ADD COLUMN     "reviewed_at" TIMESTAMPTZ(3),
ADD COLUMN     "reviewed_by" VARCHAR(255),
ADD COLUMN     "submitted_at" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "ai_safety_events" ALTER COLUMN "session_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "ai_user_state" ADD COLUMN     "age_checked_at" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "ai_consents" (
    "id" UUID NOT NULL,
    "user_id" VARCHAR(255) NOT NULL,
    "type" "AiConsentType" NOT NULL,
    "text_version" INTEGER NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_sync_cursors" (
    "name" VARCHAR(64) NOT NULL,
    "value" VARCHAR(255) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ai_sync_cursors_pkey" PRIMARY KEY ("name")
);

-- CreateTable
CREATE TABLE "ai_staff_roles" (
    "psychologist_id" VARCHAR(255) NOT NULL,
    "role" "AiStaffRole" NOT NULL,
    "granted_by" VARCHAR(255) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_staff_roles_pkey" PRIMARY KEY ("psychologist_id","role")
);

-- CreateTable
CREATE TABLE "ai_persona_workspaces" (
    "psychologist_id" VARCHAR(255) NOT NULL,
    "persona_id" VARCHAR(64) NOT NULL,
    "display_name" VARCHAR(120),
    "questionnaire_version" INTEGER,
    "answers" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ai_persona_workspaces_pkey" PRIMARY KEY ("psychologist_id")
);

-- CreateTable
CREATE TABLE "ai_eval_cases" (
    "id" UUID NOT NULL,
    "author_psychologist_id" VARCHAR(255) NOT NULL,
    "persona_id" VARCHAR(64) NOT NULL,
    "case_ref" VARCHAR(128) NOT NULL,
    "case_version" INTEGER NOT NULL,
    "scenario" TEXT NOT NULL,
    "ideal_response" TEXT NOT NULL,
    "expected_risk_level" "AiRiskLevel" NOT NULL DEFAULT 'normal',
    "usage" "AiEvalCaseUsage" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ai_eval_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_eval_runs" (
    "id" UUID NOT NULL,
    "persona_id" VARCHAR(64) NOT NULL,
    "persona_version" INTEGER NOT NULL,
    "trigger" VARCHAR(16) NOT NULL DEFAULT 'manual',
    "status" "AiEvalRunStatus" NOT NULL DEFAULT 'queued',
    "model" VARCHAR(128),
    "prompt_version" VARCHAR(64),
    "created_by" VARCHAR(255) NOT NULL,
    "started_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_eval_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_eval_ratings" (
    "id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "ai_response" TEXT NOT NULL,
    "risk_level" "AiRiskLevel" NOT NULL DEFAULT 'normal',
    "replaced" BOOLEAN NOT NULL DEFAULT false,
    "rater_id" VARCHAR(255),
    "safe" BOOLEAN,
    "on_style" BOOLEAN,
    "notes" VARCHAR(2000),
    "rated_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_eval_ratings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_consents_user_id_type_created_at_idx" ON "ai_consents"("user_id", "type", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "ai_persona_workspaces_persona_id_key" ON "ai_persona_workspaces"("persona_id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_eval_cases_persona_id_case_ref_key" ON "ai_eval_cases"("persona_id", "case_ref");

-- CreateIndex
CREATE INDEX "ai_eval_runs_persona_id_persona_version_idx" ON "ai_eval_runs"("persona_id", "persona_version");

-- CreateIndex
CREATE UNIQUE INDEX "ai_eval_ratings_run_id_case_id_key" ON "ai_eval_ratings"("run_id", "case_id");

-- CreateIndex
CREATE INDEX "ai_safety_events_reviewed_at_created_at_idx" ON "ai_safety_events"("reviewed_at", "created_at");

-- AddForeignKey
ALTER TABLE "ai_safety_events" ADD CONSTRAINT "ai_safety_events_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "ai_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_eval_ratings" ADD CONSTRAINT "ai_eval_ratings_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "ai_eval_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Every approved content version names its approver and approval time (03 Phase 5 exit
-- criteria). Prisma has no CHECK syntax, so this lives only in SQL.
ALTER TABLE "ai_content_versions" ADD CONSTRAINT "ai_content_versions_approved_has_approver"
  CHECK ("status" <> 'approved' OR ("approved_by" IS NOT NULL AND "approved_at" IS NOT NULL));
