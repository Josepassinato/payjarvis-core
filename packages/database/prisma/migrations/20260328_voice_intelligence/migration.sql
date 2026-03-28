-- Voice Intelligence: adaptive learning per contact + call analysis fields

-- Expand call_recordings with analysis fields
ALTER TABLE "call_recordings" ADD COLUMN IF NOT EXISTS "callOutcome" TEXT DEFAULT 'completed';
ALTER TABLE "call_recordings" ADD COLUMN IF NOT EXISTS "personMood" TEXT;
ALTER TABLE "call_recordings" ADD COLUMN IF NOT EXISTS "adaptationNotes" TEXT;
ALTER TABLE "call_recordings" ADD COLUMN IF NOT EXISTS "detectedAsBot" BOOLEAN DEFAULT false;
ALTER TABLE "call_recordings" ADD COLUMN IF NOT EXISTS "botDetectionMoment" TEXT;

-- Call Intelligence: per-contact adaptive learning
CREATE TABLE IF NOT EXISTS "call_intelligence" (
  "id" TEXT NOT NULL,
  "contactPhone" TEXT NOT NULL,
  "contactName" TEXT,
  "totalCalls" INTEGER NOT NULL DEFAULT 0,
  "avgDurationSeconds" INTEGER NOT NULL DEFAULT 0,
  "successfulCalls" INTEGER NOT NULL DEFAULT 0,
  "preferredGreeting" TEXT,
  "personalityType" TEXT,
  "speaksLanguage" TEXT DEFAULT 'en',
  "bestTimeToCall" TEXT,
  "notes" TEXT,
  "lastCallOutcome" TEXT,
  "lastCallMood" TEXT,
  "lastCallAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "call_intelligence_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "call_intelligence_contactPhone_key" ON "call_intelligence"("contactPhone");
CREATE INDEX IF NOT EXISTS "call_intelligence_contactName_idx" ON "call_intelligence"("contactName");
