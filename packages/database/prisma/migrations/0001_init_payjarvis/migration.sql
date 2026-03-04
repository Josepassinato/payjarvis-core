-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'PENDING_KYC');

-- CreateEnum
CREATE TYPE "KycLevel" AS ENUM ('NONE', 'BASIC', 'VERIFIED', 'ENHANCED');

-- CreateEnum
CREATE TYPE "BotStatus" AS ENUM ('ACTIVE', 'PAUSED', 'REVOKED');

-- CreateEnum
CREATE TYPE "BotPlatform" AS ENUM ('TELEGRAM', 'DISCORD', 'WHATSAPP', 'SLACK', 'CUSTOM_API');

-- CreateEnum
CREATE TYPE "BditTokenStatus" AS ENUM ('ISSUED', 'USED', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "TransactionDecision" AS ENUM ('APPROVED', 'BLOCKED', 'PENDING_HUMAN');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "MerchantPlan" AS ENUM ('FREE', 'STARTER', 'PRO', 'ENTERPRISE');

-- CreateEnum
CREATE TYPE "MerchantStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'PENDING_REVIEW');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "clerkId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "kycLevel" "KycLevel" NOT NULL DEFAULT 'NONE',
    "status" "UserStatus" NOT NULL DEFAULT 'PENDING_KYC',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bots" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "platform" "BotPlatform" NOT NULL,
    "apiKeyHash" TEXT NOT NULL,
    "status" "BotStatus" NOT NULL DEFAULT 'ACTIVE',
    "trustScore" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "totalApproved" INTEGER NOT NULL DEFAULT 0,
    "totalBlocked" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "policies" (
    "id" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "maxPerTransaction" DOUBLE PRECISION NOT NULL DEFAULT 100,
    "maxPerDay" DOUBLE PRECISION NOT NULL DEFAULT 500,
    "maxPerWeek" DOUBLE PRECISION NOT NULL DEFAULT 2000,
    "maxPerMonth" DOUBLE PRECISION NOT NULL DEFAULT 5000,
    "autoApproveLimit" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "requireApprovalUp" DOUBLE PRECISION NOT NULL DEFAULT 200,
    "allowedDays" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5]::INTEGER[],
    "allowedHoursStart" INTEGER NOT NULL DEFAULT 8,
    "allowedHoursEnd" INTEGER NOT NULL DEFAULT 22,
    "allowedCategories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "blockedCategories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "merchantWhitelist" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "merchantBlacklist" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bdit_tokens" (
    "id" TEXT NOT NULL,
    "jti" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "merchantId" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "category" TEXT NOT NULL,
    "status" "BditTokenStatus" NOT NULL DEFAULT 'ISSUED',
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),

    CONSTRAINT "bdit_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "merchantId" TEXT,
    "merchantName" TEXT NOT NULL,
    "bdtJti" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "category" TEXT NOT NULL,
    "decision" "TransactionDecision" NOT NULL,
    "decisionReason" TEXT NOT NULL,
    "approvalId" TEXT,
    "approvedByHuman" BOOLEAN NOT NULL DEFAULT false,
    "stripePaymentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_requests" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "merchantName" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "respondedAt" TIMESTAMP(3),
    "pushSent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchants" (
    "id" TEXT NOT NULL,
    "merchantKey" TEXT NOT NULL,
    "apiKeyHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "website" TEXT,
    "plan" "MerchantPlan" NOT NULL DEFAULT 'FREE',
    "webhookUrl" TEXT,
    "minTrustScore" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "status" "MerchantStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "merchants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "payload" JSONB,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_clerkId_key" ON "users"("clerkId");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "bots_ownerId_idx" ON "bots"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "policies_botId_key" ON "policies"("botId");

-- CreateIndex
CREATE UNIQUE INDEX "bdit_tokens_jti_key" ON "bdit_tokens"("jti");

-- CreateIndex
CREATE INDEX "bdit_tokens_botId_idx" ON "bdit_tokens"("botId");

-- CreateIndex
CREATE INDEX "bdit_tokens_jti_idx" ON "bdit_tokens"("jti");

-- CreateIndex
CREATE INDEX "transactions_botId_idx" ON "transactions"("botId");

-- CreateIndex
CREATE INDEX "transactions_ownerId_idx" ON "transactions"("ownerId");

-- CreateIndex
CREATE INDEX "transactions_createdAt_idx" ON "transactions"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "approval_requests_transactionId_key" ON "approval_requests"("transactionId");

-- CreateIndex
CREATE INDEX "approval_requests_ownerId_status_idx" ON "approval_requests"("ownerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "merchants_merchantKey_key" ON "merchants"("merchantKey");

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_idx" ON "audit_logs"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- AddForeignKey
ALTER TABLE "bots" ADD CONSTRAINT "bots_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policies" ADD CONSTRAINT "policies_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bdit_tokens" ADD CONSTRAINT "bdit_tokens_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bdit_tokens" ADD CONSTRAINT "bdit_tokens_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "merchants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
