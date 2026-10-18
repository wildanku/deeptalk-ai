-- CreateTable
CREATE TABLE "ai_assessment_referrals" (
    "id" UUID NOT NULL,
    "user_id" VARCHAR(255) NOT NULL,
    "session_id" UUID,
    "assessment_id" VARCHAR(255) NOT NULL,
    "topic" VARCHAR(64) NOT NULL,
    "offered_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "opened_at" TIMESTAMPTZ(3),

    CONSTRAINT "ai_assessment_referrals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_assessment_referrals_user_id_idx" ON "ai_assessment_referrals"("user_id");

-- CreateIndex
CREATE INDEX "ai_assessment_referrals_offered_at_idx" ON "ai_assessment_referrals"("offered_at");

-- AddForeignKey
ALTER TABLE "ai_assessment_referrals" ADD CONSTRAINT "ai_assessment_referrals_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "ai_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
