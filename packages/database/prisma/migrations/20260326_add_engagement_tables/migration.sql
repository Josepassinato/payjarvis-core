-- CreateTable
CREATE TABLE "user_notification_preferences" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "morningBriefing" BOOLEAN NOT NULL DEFAULT true,
    "priceAlerts" BOOLEAN NOT NULL DEFAULT true,
    "reengagement" BOOLEAN NOT NULL DEFAULT true,
    "weeklyReport" BOOLEAN NOT NULL DEFAULT true,
    "smartTips" BOOLEAN NOT NULL DEFAULT true,
    "achievements" BOOLEAN NOT NULL DEFAULT true,
    "birthday" BOOLEAN NOT NULL DEFAULT true,
    "pushEnabled" BOOLEAN NOT NULL DEFAULT true,
    "timezone" TEXT NOT NULL DEFAULT 'America/New_York',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_gamification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "streakDays" INTEGER NOT NULL DEFAULT 0,
    "longestStreak" INTEGER NOT NULL DEFAULT 0,
    "totalSearches" INTEGER NOT NULL DEFAULT 0,
    "totalCalls" INTEGER NOT NULL DEFAULT 0,
    "totalRestaurants" INTEGER NOT NULL DEFAULT 0,
    "totalSavingsUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalInteractions" INTEGER NOT NULL DEFAULT 0,
    "level" TEXT NOT NULL DEFAULT 'newbie',
    "achievements" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastInteraction" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_gamification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proactive_message_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "proactive_message_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_subscriptions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_notification_preferences_userId_key" ON "user_notification_preferences"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "user_gamification_userId_key" ON "user_gamification"("userId");

-- CreateIndex
CREATE INDEX "proactive_message_logs_userId_type_idx" ON "proactive_message_logs"("userId", "type");

-- CreateIndex
CREATE INDEX "proactive_message_logs_userId_sentAt_idx" ON "proactive_message_logs"("userId", "sentAt");

-- CreateIndex
CREATE INDEX "push_subscriptions_userId_idx" ON "push_subscriptions"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "push_subscriptions_userId_endpoint_key" ON "push_subscriptions"("userId", "endpoint");
