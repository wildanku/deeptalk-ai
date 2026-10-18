-- CreateEnum
CREATE TYPE "AiContentKind" AS ENUM ('persona_card', 'protocol', 'routine_item', 'l1_phrases', 'knowledge');

-- CreateEnum
CREATE TYPE "AiContentStatus" AS ENUM ('draft', 'in_review', 'approved', 'retired');

-- CreateEnum
CREATE TYPE "AiPersonaStatus" AS ENUM ('active', 'disabled');

-- CreateEnum
CREATE TYPE "AiSafetyLayer" AS ENUM ('l1', 'l2', 'l3', 'system');

-- CreateEnum
CREATE TYPE "AiRoutineProposalStatus" AS ENUM ('proposed', 'accepted', 'rejected', 'expired');

-- CreateEnum
CREATE TYPE "AiUserRoutineStatus" AS ENUM ('active', 'paused', 'stopped');

-- CreateEnum
CREATE TYPE "AiHandoffStatus" AS ENUM ('draft', 'approved', 'declined', 'pending_confirmation', 'linked', 'viewed');

-- AlterEnum
ALTER TYPE "AiMessageRole" ADD VALUE 'protocol';

-- AlterTable
ALTER TABLE "ai_sessions" ADD COLUMN     "closing_deadline" TIMESTAMPTZ(3),
ADD COLUMN     "normal_streak" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "router_reason" VARCHAR(500),
ADD COLUMN     "topics" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "warning_sent" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ai_session_summaries" (
    "session_id" UUID NOT NULL,
    "user_id" VARCHAR(255) NOT NULL,
    "summary_ciphertext" BYTEA NOT NULL,
    "exclude_from_training" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_session_summaries_pkey" PRIMARY KEY ("session_id")
);

-- CreateTable
CREATE TABLE "ai_safety_events" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "message_id" UUID,
    "layer" "AiSafetyLayer" NOT NULL,
    "level" "AiRiskLevel" NOT NULL,
    "signals" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_by" VARCHAR(255),
    "reviewed_at" TIMESTAMPTZ(3),
    "review_notes" TEXT,

    CONSTRAINT "ai_safety_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_content_versions" (
    "id" UUID NOT NULL,
    "kind" "AiContentKind" NOT NULL,
    "ref_id" VARCHAR(128) NOT NULL,
    "version" INTEGER NOT NULL,
    "body" JSONB NOT NULL,
    "status" "AiContentStatus" NOT NULL DEFAULT 'draft',
    "author_id" VARCHAR(255),
    "approved_by" VARCHAR(255),
    "approved_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_content_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_personas" (
    "id" VARCHAR(64) NOT NULL,
    "psychologist_id" VARCHAR(255) NOT NULL,
    "display_name" VARCHAR(255) NOT NULL,
    "active_version" INTEGER,
    "status" "AiPersonaStatus" NOT NULL DEFAULT 'active',
    "disabled_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ai_personas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_assessment_mappings" (
    "id" UUID NOT NULL,
    "topic" VARCHAR(64) NOT NULL,
    "assessment_product_id" VARCHAR(255) NOT NULL,
    "approved_by" VARCHAR(255),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_assessment_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_handoff_psikologs" (
    "psychologist_id" VARCHAR(255) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ai_handoff_psikologs_pkey" PRIMARY KEY ("psychologist_id")
);

-- CreateTable
CREATE TABLE "ai_routine_proposals" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "user_id" VARCHAR(255) NOT NULL,
    "routine" JSONB NOT NULL,
    "status" "AiRoutineProposalStatus" NOT NULL DEFAULT 'proposed',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMPTZ(3),

    CONSTRAINT "ai_routine_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_user_routines" (
    "id" UUID NOT NULL,
    "user_id" VARCHAR(255) NOT NULL,
    "source_session_id" UUID,
    "proposal_id" UUID,
    "routine" JSONB NOT NULL,
    "status" "AiUserRoutineStatus" NOT NULL DEFAULT 'active',
    "reminder_times" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "timezone" VARCHAR(64) NOT NULL DEFAULT 'Asia/Jakarta',
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stopped_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ai_user_routines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_routine_logs" (
    "id" UUID NOT NULL,
    "user_routine_id" UUID NOT NULL,
    "item_id" VARCHAR(128) NOT NULL,
    "date" DATE NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "value" INTEGER,
    "note_ciphertext" BYTEA,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ai_routine_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_handoffs" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "user_id" VARCHAR(255) NOT NULL,
    "psychologist_id" VARCHAR(255) NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "draft_ciphertext" BYTEA NOT NULL,
    "final_ciphertext" BYTEA,
    "removed_section_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "AiHandoffStatus" NOT NULL DEFAULT 'draft',
    "booking_id" VARCHAR(255),
    "booked_psychologist_id" VARCHAR(255),
    "approved_at" TIMESTAMPTZ(3),
    "linked_at" TIMESTAMPTZ(3),
    "viewed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_handoffs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_session_summaries_user_id_created_at_idx" ON "ai_session_summaries"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_safety_events_level_created_at_idx" ON "ai_safety_events"("level", "created_at");

-- CreateIndex
CREATE INDEX "ai_safety_events_session_id_idx" ON "ai_safety_events"("session_id");

-- CreateIndex
CREATE INDEX "ai_content_versions_kind_status_idx" ON "ai_content_versions"("kind", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ai_content_versions_kind_ref_id_version_key" ON "ai_content_versions"("kind", "ref_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "ai_assessment_mappings_topic_assessment_product_id_key" ON "ai_assessment_mappings"("topic", "assessment_product_id");

-- CreateIndex
CREATE INDEX "ai_routine_proposals_user_id_status_idx" ON "ai_routine_proposals"("user_id", "status");

-- CreateIndex
CREATE INDEX "ai_user_routines_user_id_status_idx" ON "ai_user_routines"("user_id", "status");

-- CreateIndex
CREATE INDEX "ai_user_routines_status_idx" ON "ai_user_routines"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ai_routine_logs_user_routine_id_item_id_date_key" ON "ai_routine_logs"("user_routine_id", "item_id", "date");

-- CreateIndex
CREATE INDEX "ai_handoffs_user_id_status_idx" ON "ai_handoffs"("user_id", "status");

-- CreateIndex
CREATE INDEX "ai_handoffs_booking_id_idx" ON "ai_handoffs"("booking_id");

-- AddForeignKey
ALTER TABLE "ai_safety_events" ADD CONSTRAINT "ai_safety_events_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "ai_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_routine_logs" ADD CONSTRAINT "ai_routine_logs_user_routine_id_fkey" FOREIGN KEY ("user_routine_id") REFERENCES "ai_user_routines"("id") ON DELETE CASCADE ON UPDATE CASCADE;
