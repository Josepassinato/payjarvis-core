-- Call Playbooks: pre-defined scripts for common call tasks

CREATE TABLE IF NOT EXISTS "call_playbooks" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "language" TEXT NOT NULL DEFAULT 'en',
  "openingLine" TEXT NOT NULL,
  "requiredInfo" JSONB NOT NULL DEFAULT '[]',
  "scriptSteps" JSONB NOT NULL DEFAULT '[]',
  "successCriteria" TEXT,
  "commonObjections" JSONB DEFAULT '[]',
  "avgDurationSeconds" INTEGER DEFAULT 120,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "call_playbooks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "call_playbooks_name_language_key" ON "call_playbooks"("name", "language");
CREATE INDEX IF NOT EXISTS "call_playbooks_category_idx" ON "call_playbooks"("category");
