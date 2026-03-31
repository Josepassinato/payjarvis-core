-- CreateTable: coupon_cache
CREATE TABLE "coupon_cache" (
    "id" TEXT NOT NULL,
    "store" VARCHAR(100) NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "description" TEXT NOT NULL,
    "discountType" VARCHAR(20) NOT NULL,
    "discountValue" DOUBLE PRECISION,
    "minPurchase" DOUBLE PRECISION,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3),
    "source" VARCHAR(50) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coupon_cache_pkey" PRIMARY KEY ("id")
);

-- CreateTable: price_history
CREATE TABLE "price_history" (
    "id" TEXT NOT NULL,
    "productIdentifier" VARCHAR(200) NOT NULL,
    "store" VARCHAR(100) NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'USD',
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "price_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "coupon_cache_store_createdAt_idx" ON "coupon_cache"("store", "createdAt");

-- CreateIndex
CREATE INDEX "price_history_productIdentifier_recordedAt_idx" ON "price_history"("productIdentifier", "recordedAt");

-- CreateIndex
CREATE INDEX "price_history_productIdentifier_idx" ON "price_history"("productIdentifier");
