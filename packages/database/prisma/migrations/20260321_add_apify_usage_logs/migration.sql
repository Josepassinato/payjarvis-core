-- CreateTable
CREATE TABLE "apify_usage_logs" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "user_id" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "platforms" TEXT NOT NULL,
    "cost_real_usd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "cost_charged_usd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "apify_usage_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "apify_usage_logs_user_id_idx" ON "apify_usage_logs"("user_id");
CREATE INDEX "apify_usage_logs_created_at_idx" ON "apify_usage_logs"("created_at");
CREATE INDEX "apify_usage_logs_operation_idx" ON "apify_usage_logs"("operation");
