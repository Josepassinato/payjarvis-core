-- CreateTable
CREATE TABLE "watchdog_promises" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" TEXT NOT NULL,
    "channel" VARCHAR(20) NOT NULL,
    "promise_text" TEXT NOT NULL,
    "promised_action" VARCHAR(100),
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "fallback_sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fulfilled_at" TIMESTAMP(3),

    CONSTRAINT "watchdog_promises_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "watchdog_promises_status_created_at_idx" ON "watchdog_promises"("status", "created_at");

-- CreateIndex
CREATE INDEX "watchdog_promises_user_id_status_idx" ON "watchdog_promises"("user_id", "status");
