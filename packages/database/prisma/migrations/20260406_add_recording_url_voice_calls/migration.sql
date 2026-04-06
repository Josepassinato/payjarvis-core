-- Add recordingUrl column to voice_calls for storing Twilio recording URLs
ALTER TABLE "voice_calls" ADD COLUMN IF NOT EXISTS "recordingUrl" TEXT;
