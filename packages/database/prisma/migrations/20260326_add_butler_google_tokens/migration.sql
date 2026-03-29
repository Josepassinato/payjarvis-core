-- Butler Connected Accounts (Google/Microsoft OAuth tokens)

CREATE TABLE "butler_connected_accounts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "tokenExpiry" TIMESTAMP(3),
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "butler_connected_accounts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "butler_connected_accounts_userId_provider_key" ON "butler_connected_accounts"("userId", "provider");
CREATE INDEX "butler_connected_accounts_userId_idx" ON "butler_connected_accounts"("userId");
