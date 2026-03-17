-- AlterTable: Add unique constraint to User.phone and User.telegramChatId
-- These ensure multi-tenant isolation: no two users can share the same phone or telegram ID

-- First clean any NULL/empty phones that could conflict
UPDATE users SET phone = NULL WHERE phone = '';

-- Add unique constraints
CREATE UNIQUE INDEX IF NOT EXISTS "users_phone_key" ON "users"("phone");
CREATE UNIQUE INDEX IF NOT EXISTS "users_telegramChatId_key" ON "users"("telegramChatId");

-- Add emailAttempts column to onboarding_sessions (brute-force protection)
ALTER TABLE "onboarding_sessions" ADD COLUMN IF NOT EXISTS "emailAttempts" INTEGER NOT NULL DEFAULT 0;

-- Remove redundant index (telegramChatId already has unique index from constraint)
DROP INDEX IF EXISTS "onboarding_sessions_telegramChatId_idx";
