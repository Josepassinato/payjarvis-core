-- CreateTable
CREATE TABLE "bot_share_links" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "templateConfig" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "maxUses" INTEGER,
    "useCount" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bot_share_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bot_clones" (
    "id" TEXT NOT NULL,
    "shareCode" TEXT NOT NULL,
    "newBotId" TEXT NOT NULL,
    "newUserId" TEXT NOT NULL,
    "referredByUserId" TEXT NOT NULL,
    "clonedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bot_clones_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bot_share_links_code_key" ON "bot_share_links"("code");

-- CreateIndex
CREATE INDEX "bot_share_links_code_idx" ON "bot_share_links"("code");

-- CreateIndex
CREATE INDEX "bot_share_links_createdByUserId_idx" ON "bot_share_links"("createdByUserId");

-- CreateIndex
CREATE INDEX "bot_share_links_botId_idx" ON "bot_share_links"("botId");

-- CreateIndex
CREATE INDEX "bot_clones_shareCode_idx" ON "bot_clones"("shareCode");

-- CreateIndex
CREATE INDEX "bot_clones_newUserId_idx" ON "bot_clones"("newUserId");

-- CreateIndex
CREATE INDEX "bot_clones_referredByUserId_idx" ON "bot_clones"("referredByUserId");

-- AddForeignKey
ALTER TABLE "bot_share_links" ADD CONSTRAINT "bot_share_links_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot_share_links" ADD CONSTRAINT "bot_share_links_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot_clones" ADD CONSTRAINT "bot_clones_shareCode_fkey" FOREIGN KEY ("shareCode") REFERENCES "bot_share_links"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot_clones" ADD CONSTRAINT "bot_clones_newBotId_fkey" FOREIGN KEY ("newBotId") REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot_clones" ADD CONSTRAINT "bot_clones_newUserId_fkey" FOREIGN KEY ("newUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
