-- Add WhatsApp trial fields to users table
ALTER TABLE "users" ADD COLUMN "whatsapp_trial_starts_at" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "whatsapp_trial_ends_at" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "whatsapp_trial_expired" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN "referral_bonus_days" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "users" ADD COLUMN "referred_by_user_id" TEXT;
ALTER TABLE "users" ADD COLUMN "referral_count" INTEGER NOT NULL DEFAULT 0;
