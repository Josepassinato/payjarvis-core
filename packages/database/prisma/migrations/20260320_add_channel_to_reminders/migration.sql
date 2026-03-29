-- AlterTable: add channel awareness to reminders
ALTER TABLE "openclaw_reminders" ADD COLUMN IF NOT EXISTS "channel" VARCHAR DEFAULT 'telegram';
ALTER TABLE "openclaw_reminders" ADD COLUMN IF NOT EXISTS "channel_id" VARCHAR;
