-- CreateTable
CREATE TABLE "ai_psikolog_recommendations" (
    "id" UUID NOT NULL,
    "user_id" VARCHAR(255) NOT NULL,
    "session_id" UUID,
    "psychologist_ids" VARCHAR(255)[],
    "offered_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "opened_at" TIMESTAMPTZ(3),
    "opened_psychologist_id" VARCHAR(255),

    CONSTRAINT "ai_psikolog_recommendations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_psikolog_recommendations_user_id_idx" ON "ai_psikolog_recommendations"("user_id");

-- CreateIndex
CREATE INDEX "ai_psikolog_recommendations_offered_at_idx" ON "ai_psikolog_recommendations"("offered_at");

-- AddForeignKey
ALTER TABLE "ai_psikolog_recommendations" ADD CONSTRAINT "ai_psikolog_recommendations_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "ai_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
