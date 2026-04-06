-- CreateTable
CREATE TABLE "tool_call_logs" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "userId" TEXT,
    "toolName" VARCHAR(64) NOT NULL,
    "parameters" JSONB,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "duration" INTEGER NOT NULL DEFAULT 0,
    "channel" VARCHAR(20) NOT NULL,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tool_call_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tool_call_logs_toolName_createdAt_idx" ON "tool_call_logs"("toolName", "createdAt");
CREATE INDEX "tool_call_logs_userId_createdAt_idx" ON "tool_call_logs"("userId", "createdAt");
CREATE INDEX "tool_call_logs_createdAt_idx" ON "tool_call_logs"("createdAt");
