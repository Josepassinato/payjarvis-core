-- Add SKYFIRE to PaymentProvider enum
ALTER TYPE "PaymentProvider" ADD VALUE IF NOT EXISTS 'SKYFIRE';

-- Purchase Transactions (actual purchases made through Skyfire/Visa TAP)
CREATE TABLE IF NOT EXISTS "purchase_transactions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'SKYFIRE',
    "product_name" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "merchant" TEXT NOT NULL,
    "merchant_url" TEXT,
    "order_number" TEXT,
    "tracking_number" TEXT,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "skyfire_token_jti" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_transactions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "purchase_transactions_user_id_created_at_idx" ON "purchase_transactions"("user_id", "created_at");
CREATE INDEX IF NOT EXISTS "purchase_transactions_user_id_status_idx" ON "purchase_transactions"("user_id", "status");

-- Spending Limits (per-user configurable limits)
CREATE TABLE IF NOT EXISTS "spending_limits" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "per_transaction" DOUBLE PRECISION NOT NULL DEFAULT 100,
    "daily" DOUBLE PRECISION NOT NULL DEFAULT 500,
    "monthly" DOUBLE PRECISION NOT NULL DEFAULT 2000,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "spending_limits_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "spending_limits_user_id_key" ON "spending_limits"("user_id");
