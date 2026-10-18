-- CreateEnum
CREATE TYPE "AiRiskLevel" AS ENUM ('normal', 'elevated', 'crisis');

-- CreateEnum
CREATE TYPE "AiSessionStatus" AS ENUM ('active', 'closing', 'ended');

-- CreateEnum
CREATE TYPE "AiSessionEndReason" AS ENUM ('completed', 'idle', 'wall_clock');

-- CreateEnum
CREATE TYPE "AiMessageRole" AS ENUM ('user', 'assistant');

-- CreateEnum
CREATE TYPE "AiOutboxStatus" AS ENUM ('pending', 'processing', 'done', 'failed');

-- CreateTable
CREATE TABLE "ai_user_state" (
    "user_id" VARCHAR(255) NOT NULL,
    "age_band" VARCHAR(16),
    "onboarded_at" TIMESTAMPTZ(3),
    "last_session_at" TIMESTAMPTZ(3),
    "memory_enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ai_user_state_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "ai_sessions" (
    "id" UUID NOT NULL,
    "user_id" VARCHAR(255) NOT NULL,
    "persona_id" VARCHAR(255),
    "persona_version" INTEGER,
    "period_month" CHAR(7) NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_activity_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "active_seconds" INTEGER NOT NULL DEFAULT 0,
    "max_risk_level" "AiRiskLevel" NOT NULL DEFAULT 'normal',
    "status" "AiSessionStatus" NOT NULL DEFAULT 'active',
    "end_reason" "AiSessionEndReason",
    "ended_at" TIMESTAMPTZ(3),
    "counts_toward_quota" BOOLEAN NOT NULL DEFAULT true,
    "exclude_from_training" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ai_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_messages" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "role" "AiMessageRole" NOT NULL,
    "content_ciphertext" BYTEA NOT NULL,
    "risk_level" "AiRiskLevel",
    "persona_version" INTEGER,
    "model" VARCHAR(128),
    "prompt_version" VARCHAR(64),
    "client_message_id" VARCHAR(64),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_outbox" (
    "id" UUID NOT NULL,
    "kind" VARCHAR(64) NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "AiOutboxStatus" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "available_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ai_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_inbound_events" (
    "event_id" VARCHAR(255) NOT NULL,
    "kind" VARCHAR(64) NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_inbound_events_pkey" PRIMARY KEY ("event_id")
);

-- CreateIndex
CREATE INDEX "ai_sessions_user_id_period_month_idx" ON "ai_sessions"("user_id", "period_month");

-- CreateIndex
CREATE INDEX "ai_sessions_user_id_status_idx" ON "ai_sessions"("user_id", "status");

-- CreateIndex
CREATE INDEX "ai_messages_session_id_created_at_idx" ON "ai_messages"("session_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "ai_messages_session_id_client_message_id_key" ON "ai_messages"("session_id", "client_message_id");

-- CreateIndex
CREATE INDEX "ai_outbox_status_available_at_idx" ON "ai_outbox"("status", "available_at");

-- AddForeignKey
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "ai_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
