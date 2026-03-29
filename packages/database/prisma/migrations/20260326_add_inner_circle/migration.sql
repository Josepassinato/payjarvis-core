-- Inner Circle — Specialist Referral Network

CREATE TABLE "inner_circle_specialists" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "expertise" TEXT NOT NULL,
    "bio" TEXT NOT NULL,
    "credentials" TEXT NOT NULL,
    "instagram" TEXT,
    "website" TEXT,
    "contactLink" TEXT,
    "freeServices" TEXT NOT NULL,
    "premiumServices" TEXT NOT NULL,
    "triggerKeywords" TEXT NOT NULL,
    "triggerContexts" TEXT NOT NULL,
    "aiKnowledgePrompt" TEXT NOT NULL,
    "introMessage" TEXT NOT NULL,
    "maxFreePerUser" INTEGER NOT NULL DEFAULT 3,
    "revenueSharePct" DOUBLE PRECISION NOT NULL DEFAULT 15,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inner_circle_specialists_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "inner_circle_interactions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "specialistId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "context" TEXT,
    "converted" BOOLEAN NOT NULL DEFAULT false,
    "revenue" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inner_circle_interactions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "inner_circle_specialists_slug_key" ON "inner_circle_specialists"("slug");
CREATE INDEX "inner_circle_interactions_userId_specialistId_idx" ON "inner_circle_interactions"("userId", "specialistId");
CREATE INDEX "inner_circle_interactions_userId_createdAt_idx" ON "inner_circle_interactions"("userId", "createdAt");

ALTER TABLE "inner_circle_interactions" ADD CONSTRAINT "inner_circle_interactions_specialistId_fkey" FOREIGN KEY ("specialistId") REFERENCES "inner_circle_specialists"("id") ON DELETE CASCADE ON UPDATE CASCADE;
