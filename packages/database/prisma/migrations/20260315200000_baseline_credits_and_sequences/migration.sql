-- CreateEnum
CREATE TYPE "AgentStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'REVOKED');

-- CreateEnum
CREATE TYPE "HandoffObstacle" AS ENUM ('CAPTCHA', 'AUTH', 'NAVIGATION', 'OTHER');

-- CreateEnum
CREATE TYPE "HandoffStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'RESOLVED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('STRIPE', 'PAYPAL', 'APPLE_PAY', 'GOOGLE_PAY', 'BNPL');

-- CreateEnum
CREATE TYPE "PaymentMethodStatus" AS ENUM ('CONNECTED', 'PENDING', 'DISABLED');

-- AlterTable
ALTER TABLE "approval_requests" ADD COLUMN     "agentId" TEXT;

-- AlterTable
ALTER TABLE "bdit_tokens" ADD COLUMN     "agentId" TEXT,
ADD COLUMN     "tokenValue" TEXT;

-- AlterTable
ALTER TABLE "bots" ADD COLUMN     "bot_display_name" TEXT,
ADD COLUMN     "capabilities" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "language" TEXT NOT NULL DEFAULT 'pt-BR',
ADD COLUMN     "system_prompt" TEXT;

-- AlterTable
ALTER TABLE "policies" ADD COLUMN     "timezone" TEXT NOT NULL DEFAULT 'America/New_York';

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "agentId" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "address" JSONB,
ADD COLUMN     "approvalThreshold" DOUBLE PRECISION NOT NULL DEFAULT 50.0,
ADD COLUMN     "botActivatedAt" TIMESTAMP(3),
ADD COLUMN     "country" TEXT,
ADD COLUMN     "dateOfBirth" TIMESTAMP(3),
ADD COLUMN     "documentNumber" TEXT,
ADD COLUMN     "kycPhotoPath" TEXT,
ADD COLUMN     "kycSubmittedAt" TIMESTAMP(3),
ADD COLUMN     "notificationChannel" TEXT NOT NULL DEFAULT 'none',
ADD COLUMN     "onboardingCompleted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "onboardingStep" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "stripeAccountId" TEXT,
ADD COLUMN     "telegramChatId" TEXT,
ADD COLUMN     "termsAcceptedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "telegram_link_codes" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telegram_link_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_methods" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "status" "PaymentMethodStatus" NOT NULL DEFAULT 'PENDING',
    "accountId" TEXT,
    "credentials" JSONB,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_methods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agents" (
    "id" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "status" "AgentStatus" NOT NULL DEFAULT 'ACTIVE',
    "kycLevel" "KycLevel" NOT NULL DEFAULT 'NONE',
    "trustScore" INTEGER NOT NULL DEFAULT 500,
    "totalSpent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "transactionsCount" INTEGER NOT NULL DEFAULT 0,
    "lastActivityAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "handoff_requests" (
    "id" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "sessionUrl" TEXT NOT NULL,
    "obstacleType" "HandoffObstacle" NOT NULL,
    "description" TEXT NOT NULL,
    "metadata" JSONB,
    "status" "HandoffStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "resolvedNote" TEXT,
    "pushSent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "handoff_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_reputations" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "successfulTransactions" INTEGER NOT NULL DEFAULT 0,
    "blockedTransactions" INTEGER NOT NULL DEFAULT 0,
    "failedTransactions" INTEGER NOT NULL DEFAULT 0,
    "chargebacks" INTEGER NOT NULL DEFAULT 0,
    "anomalyEvents" INTEGER NOT NULL DEFAULT 0,
    "merchantCount" INTEGER NOT NULL DEFAULT 0,
    "merchants" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "totalSpent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "averageTransaction" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lastTransactionAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_reputations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_registrations" (
    "id" TEXT NOT NULL,
    "platformType" TEXT NOT NULL,
    "webhookUrl" TEXT NOT NULL,
    "events" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "secret" TEXT NOT NULL,
    "contactEmail" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_registrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bot_integrations" (
    "id" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "connectedAt" TIMESTAMP(3),
    "config" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bot_integrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "policy_decision_logs" (
    "id" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "action" JSONB NOT NULL,
    "allowed" BOOLEAN NOT NULL,
    "reason" TEXT NOT NULL,
    "trustLevel" TEXT NOT NULL,
    "layer" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "policy_decision_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "openclaw_instances" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "processName" TEXT NOT NULL,
    "port" INTEGER NOT NULL,
    "capacity" INTEGER NOT NULL DEFAULT 100,
    "currentLoad" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "openclaw_instances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "instance_users" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "instance_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce_search_logs" (
    "id" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "resultCount" INTEGER NOT NULL,
    "cached" BOOLEAN NOT NULL DEFAULT false,
    "durationMs" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commerce_search_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_account_vaults" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "cookiesEnc" TEXT NOT NULL,
    "userAgent" TEXT NOT NULL,
    "isValid" BOOLEAN NOT NULL DEFAULT true,
    "lastVerified" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_account_vaults_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "amazon_orders" (
    "id" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "asin" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "amazonOrderId" TEXT,
    "errorMsg" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "amazon_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_contexts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "store" TEXT NOT NULL,
    "storeUrl" TEXT NOT NULL,
    "storeLabel" TEXT NOT NULL,
    "bbContextId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'configured',
    "authenticatedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "store_contexts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_sessions" (
    "id" TEXT NOT NULL,
    "storeContextId" TEXT NOT NULL,
    "bbSessionId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "purpose" TEXT,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "store_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_bot_permissions" (
    "id" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "storeContextId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "maxPerTransaction" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "maxPerDay" DOUBLE PRECISION NOT NULL DEFAULT 150,
    "maxPerMonth" DOUBLE PRECISION NOT NULL DEFAULT 500,
    "allowedCategories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "autoApproveBelow" DOUBLE PRECISION NOT NULL DEFAULT 25,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "store_bot_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "llm_credits" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "messagesTotal" INTEGER NOT NULL DEFAULT 5000,
    "messagesUsed" INTEGER NOT NULL DEFAULT 0,
    "messagesRemaining" INTEGER NOT NULL DEFAULT 5000,
    "freeTrialEndsAt" TIMESTAMP(3),
    "freeTrialActive" BOOLEAN NOT NULL DEFAULT false,
    "alert75Sent" BOOLEAN NOT NULL DEFAULT false,
    "alert90Sent" BOOLEAN NOT NULL DEFAULT false,
    "alert100Sent" BOOLEAN NOT NULL DEFAULT false,
    "alertDay55Sent" BOOLEAN NOT NULL DEFAULT false,
    "alertDay58Sent" BOOLEAN NOT NULL DEFAULT false,
    "alertDay60Sent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "llm_credits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "llm_usage_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "totalTokens" INTEGER NOT NULL,
    "costReal" DOUBLE PRECISION NOT NULL,
    "costCharged" DOUBLE PRECISION NOT NULL,
    "messagesCharged" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "llm_usage_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_purchases" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "messagesAdded" INTEGER NOT NULL,
    "amountUsd" DOUBLE PRECISION NOT NULL,
    "stripePaymentId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_purchases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onboarding_sequences" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "currentStep" INTEGER NOT NULL DEFAULT 0,
    "nextSendAt" TIMESTAMP(3),
    "stepsCompleted" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "onboarding_sequences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "telegram_link_codes_userId_key" ON "telegram_link_codes"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "telegram_link_codes_code_key" ON "telegram_link_codes"("code");

-- CreateIndex
CREATE INDEX "payment_methods_userId_idx" ON "payment_methods"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "payment_methods_userId_provider_key" ON "payment_methods"("userId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "agents_botId_key" ON "agents"("botId");

-- CreateIndex
CREATE INDEX "agents_ownerId_idx" ON "agents"("ownerId");

-- CreateIndex
CREATE INDEX "agents_botId_idx" ON "agents"("botId");

-- CreateIndex
CREATE INDEX "handoff_requests_botId_status_idx" ON "handoff_requests"("botId", "status");

-- CreateIndex
CREATE INDEX "handoff_requests_ownerId_status_idx" ON "handoff_requests"("ownerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "agent_reputations_agentId_key" ON "agent_reputations"("agentId");

-- CreateIndex
CREATE INDEX "agent_reputations_agentId_idx" ON "agent_reputations"("agentId");

-- CreateIndex
CREATE INDEX "platform_registrations_platformType_idx" ON "platform_registrations"("platformType");

-- CreateIndex
CREATE INDEX "platform_registrations_isActive_idx" ON "platform_registrations"("isActive");

-- CreateIndex
CREATE INDEX "bot_integrations_botId_idx" ON "bot_integrations"("botId");

-- CreateIndex
CREATE UNIQUE INDEX "bot_integrations_botId_provider_key" ON "bot_integrations"("botId", "provider");

-- CreateIndex
CREATE INDEX "policy_decision_logs_botId_idx" ON "policy_decision_logs"("botId");

-- CreateIndex
CREATE INDEX "policy_decision_logs_createdAt_idx" ON "policy_decision_logs"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "openclaw_instances_port_key" ON "openclaw_instances"("port");

-- CreateIndex
CREATE INDEX "openclaw_instances_status_idx" ON "openclaw_instances"("status");

-- CreateIndex
CREATE UNIQUE INDEX "instance_users_userId_key" ON "instance_users"("userId");

-- CreateIndex
CREATE INDEX "instance_users_instanceId_idx" ON "instance_users"("instanceId");

-- CreateIndex
CREATE INDEX "commerce_search_logs_botId_idx" ON "commerce_search_logs"("botId");

-- CreateIndex
CREATE INDEX "commerce_search_logs_service_idx" ON "commerce_search_logs"("service");

-- CreateIndex
CREATE INDEX "commerce_search_logs_createdAt_idx" ON "commerce_search_logs"("createdAt");

-- CreateIndex
CREATE INDEX "user_account_vaults_userId_idx" ON "user_account_vaults"("userId");

-- CreateIndex
CREATE INDEX "user_account_vaults_provider_isValid_idx" ON "user_account_vaults"("provider", "isValid");

-- CreateIndex
CREATE UNIQUE INDEX "user_account_vaults_userId_provider_key" ON "user_account_vaults"("userId", "provider");

-- CreateIndex
CREATE INDEX "amazon_orders_userId_idx" ON "amazon_orders"("userId");

-- CreateIndex
CREATE INDEX "amazon_orders_botId_idx" ON "amazon_orders"("botId");

-- CreateIndex
CREATE INDEX "amazon_orders_status_idx" ON "amazon_orders"("status");

-- CreateIndex
CREATE INDEX "store_contexts_userId_idx" ON "store_contexts"("userId");

-- CreateIndex
CREATE INDEX "store_contexts_store_status_idx" ON "store_contexts"("store", "status");

-- CreateIndex
CREATE UNIQUE INDEX "store_contexts_userId_store_key" ON "store_contexts"("userId", "store");

-- CreateIndex
CREATE INDEX "store_sessions_storeContextId_idx" ON "store_sessions"("storeContextId");

-- CreateIndex
CREATE INDEX "store_sessions_status_idx" ON "store_sessions"("status");

-- CreateIndex
CREATE INDEX "store_bot_permissions_botId_idx" ON "store_bot_permissions"("botId");

-- CreateIndex
CREATE INDEX "store_bot_permissions_storeContextId_idx" ON "store_bot_permissions"("storeContextId");

-- CreateIndex
CREATE UNIQUE INDEX "store_bot_permissions_botId_storeContextId_key" ON "store_bot_permissions"("botId", "storeContextId");

-- CreateIndex
CREATE UNIQUE INDEX "llm_credits_userId_key" ON "llm_credits"("userId");

-- CreateIndex
CREATE INDEX "llm_credits_userId_idx" ON "llm_credits"("userId");

-- CreateIndex
CREATE INDEX "llm_credits_freeTrialEndsAt_idx" ON "llm_credits"("freeTrialEndsAt");

-- CreateIndex
CREATE INDEX "llm_usage_logs_userId_idx" ON "llm_usage_logs"("userId");

-- CreateIndex
CREATE INDEX "llm_usage_logs_createdAt_idx" ON "llm_usage_logs"("createdAt");

-- CreateIndex
CREATE INDEX "credit_purchases_userId_idx" ON "credit_purchases"("userId");

-- CreateIndex
CREATE INDEX "credit_purchases_status_idx" ON "credit_purchases"("status");

-- CreateIndex
CREATE UNIQUE INDEX "onboarding_sequences_userId_key" ON "onboarding_sequences"("userId");

-- CreateIndex
CREATE INDEX "onboarding_sequences_userId_idx" ON "onboarding_sequences"("userId");

-- CreateIndex
CREATE INDEX "onboarding_sequences_nextSendAt_idx" ON "onboarding_sequences"("nextSendAt");

-- CreateIndex
CREATE INDEX "onboarding_sequences_active_idx" ON "onboarding_sequences"("active");

-- CreateIndex
CREATE INDEX "bdit_tokens_agentId_idx" ON "bdit_tokens"("agentId");

-- CreateIndex
CREATE INDEX "transactions_agentId_idx" ON "transactions"("agentId");

-- AddForeignKey
ALTER TABLE "telegram_link_codes" ADD CONSTRAINT "telegram_link_codes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agents" ADD CONSTRAINT "agents_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agents" ADD CONSTRAINT "agents_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "handoff_requests" ADD CONSTRAINT "handoff_requests_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "handoff_requests" ADD CONSTRAINT "handoff_requests_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_reputations" ADD CONSTRAINT "agent_reputations_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot_integrations" ADD CONSTRAINT "bot_integrations_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instance_users" ADD CONSTRAINT "instance_users_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "openclaw_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instance_users" ADD CONSTRAINT "instance_users_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_contexts" ADD CONSTRAINT "store_contexts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_sessions" ADD CONSTRAINT "store_sessions_storeContextId_fkey" FOREIGN KEY ("storeContextId") REFERENCES "store_contexts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_bot_permissions" ADD CONSTRAINT "store_bot_permissions_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_bot_permissions" ADD CONSTRAINT "store_bot_permissions_storeContextId_fkey" FOREIGN KEY ("storeContextId") REFERENCES "store_contexts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

