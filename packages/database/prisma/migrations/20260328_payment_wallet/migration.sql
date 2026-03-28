-- Payment Wallet: expand PaymentProvider enum, add displayName, relax unique constraint

-- Add new enum values
ALTER TYPE "PaymentProvider" ADD VALUE IF NOT EXISTS 'AMAZON';
ALTER TYPE "PaymentProvider" ADD VALUE IF NOT EXISTS 'PIX';
ALTER TYPE "PaymentProvider" ADD VALUE IF NOT EXISTS 'CREDIT_CARD';

-- Add EXPIRED status
ALTER TYPE "PaymentMethodStatus" ADD VALUE IF NOT EXISTS 'EXPIRED';

-- Add displayName column
ALTER TABLE "payment_methods" ADD COLUMN IF NOT EXISTS "displayName" TEXT;

-- Drop old unique constraint (userId, provider) — allows multiple cards per provider
DROP INDEX IF EXISTS "payment_methods_userId_provider_key";

-- Create new unique constraint (userId, provider, accountId)
CREATE UNIQUE INDEX "payment_methods_userId_provider_accountId_key"
  ON "payment_methods" ("userId", "provider", "accountId");
