-- Call Recordings: store Twilio recording metadata for voice call analysis

CREATE TABLE IF NOT EXISTS "call_recordings" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "callSid" TEXT NOT NULL,
  "recordingSid" TEXT NOT NULL,
  "recordingUrl" TEXT NOT NULL,
  "durationSeconds" INTEGER NOT NULL DEFAULT 0,
  "fromNumber" TEXT NOT NULL DEFAULT '',
  "toNumber" TEXT NOT NULL DEFAULT '',
  "direction" TEXT NOT NULL DEFAULT 'outbound',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "call_recordings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "call_recordings_recordingSid_key" ON "call_recordings"("recordingSid");
CREATE INDEX "call_recordings_userId_idx" ON "call_recordings"("userId");
CREATE INDEX "call_recordings_callSid_idx" ON "call_recordings"("callSid");
