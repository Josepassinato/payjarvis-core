-- CreateTable
CREATE TABLE "price_alerts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "store" TEXT,
    "targetPrice" DOUBLE PRECISION NOT NULL,
    "currentPrice" DOUBLE PRECISION,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "country" TEXT NOT NULL DEFAULT 'US',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastChecked" TIMESTAMP(3),
    "notifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "price_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "price_alerts_userId_idx" ON "price_alerts"("userId");

-- CreateIndex
CREATE INDEX "price_alerts_active_lastChecked_idx" ON "price_alerts"("active", "lastChecked");
