-- CreateEnum
CREATE TYPE "AiReportReason" AS ENUM ('harmful', 'inaccurate', 'inappropriate', 'other');

-- AlterTable
ALTER TABLE "ai_sessions" ADD COLUMN     "tokens_input" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "tokens_output" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "turns" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "ai_message_reports" (
    "id" UUID NOT NULL,
    "message_id" UUID,
    "session_id" UUID,
    "persona_id" VARCHAR(64),
    "persona_version" INTEGER,
    "reason" "AiReportReason" NOT NULL,
    "share_content" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_by" VARCHAR(255),
    "reviewed_at" TIMESTAMPTZ(3),
    "review_notes" VARCHAR(2000),

    CONSTRAINT "ai_message_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_message_reports_message_id_key" ON "ai_message_reports"("message_id");

-- CreateIndex
CREATE INDEX "ai_message_reports_reviewed_at_created_at_idx" ON "ai_message_reports"("reviewed_at", "created_at");

-- AddForeignKey
ALTER TABLE "ai_message_reports" ADD CONSTRAINT "ai_message_reports_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "ai_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_message_reports" ADD CONSTRAINT "ai_message_reports_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "ai_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
