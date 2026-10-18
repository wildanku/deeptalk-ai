-- CreateTable
CREATE TABLE "ai_local_tasks" (
    "name" VARCHAR(500) NOT NULL,
    "queue" VARCHAR(64) NOT NULL,
    "payload" JSONB NOT NULL,
    "run_at" TIMESTAMPTZ(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "deadline_seconds" INTEGER NOT NULL DEFAULT 60,
    "locked_until" TIMESTAMPTZ(3),
    "done_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_local_tasks_pkey" PRIMARY KEY ("name")
);

-- CreateIndex
CREATE INDEX "ai_local_tasks_run_at_idx" ON "ai_local_tasks"("run_at");
