-- CreateTable
CREATE TABLE "onboarding_sessions" (
    "id" TEXT NOT NULL,
    "telegramChatId" TEXT,
    "whatsappPhone" TEXT,
    "shareCode" TEXT,
    "step" TEXT NOT NULL DEFAULT 'start',
    "email" TEXT,
    "emailToken" TEXT,
    "userId" TEXT,
    "botId" TEXT,
    "limitsSet" BOOLEAN NOT NULL DEFAULT false,
    "paymentSetup" BOOLEAN NOT NULL DEFAULT false,
    "stripeSetupIntent" TEXT,
    "stripePaymentLink" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "onboarding_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "onboarding_sessions_telegramChatId_key" ON "onboarding_sessions"("telegramChatId");

-- CreateIndex
CREATE UNIQUE INDEX "onboarding_sessions_whatsappPhone_key" ON "onboarding_sessions"("whatsappPhone");

-- CreateIndex
CREATE INDEX "onboarding_sessions_telegramChatId_idx" ON "onboarding_sessions"("telegramChatId");

-- CreateIndex
CREATE INDEX "onboarding_sessions_shareCode_idx" ON "onboarding_sessions"("shareCode");

-- CreateIndex
CREATE INDEX "onboarding_sessions_userId_idx" ON "onboarding_sessions"("userId");
