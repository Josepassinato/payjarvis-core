-- AlterTable: Add botNickname to users
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "botNickname" TEXT;

-- AlterTable: Add new columns to onboarding_sessions
ALTER TABLE "onboarding_sessions" ADD COLUMN IF NOT EXISTS "botNickname" TEXT;
ALTER TABLE "onboarding_sessions" ADD COLUMN IF NOT EXISTS "password" TEXT;
ALTER TABLE "onboarding_sessions" ADD COLUMN IF NOT EXISTS "storesConfigured" BOOLEAN NOT NULL DEFAULT false;
