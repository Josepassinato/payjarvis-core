-- CreateTable: user_subscriptions
CREATE TABLE "user_subscriptions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "serviceName" VARCHAR(200) NOT NULL,
    "serviceDomain" VARCHAR(200),
    "planName" VARCHAR(100),
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'USD',
    "billingCycle" VARCHAR(20) NOT NULL DEFAULT 'monthly',
    "nextBillingDate" TIMESTAMP(3),
    "lastBilledDate" TIMESTAMP(3),
    "status" VARCHAR(20) NOT NULL DEFAULT 'active',
    "paymentMethod" VARCHAR(50) NOT NULL,
    "externalSubscriptionId" VARCHAR(200),
    "canCancelViaApi" BOOLEAN NOT NULL DEFAULT false,
    "cancelUrl" TEXT,
    "cancellationProofUrl" TEXT,
    "monthlyEquivalent" DOUBLE PRECISION,
    "discoveredVia" VARCHAR(50) NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_subscriptions_userId_serviceName_paymentMethod_key" ON "user_subscriptions"("userId", "serviceName", "paymentMethod");

-- CreateIndex
CREATE INDEX "user_subscriptions_userId_status_idx" ON "user_subscriptions"("userId", "status");
