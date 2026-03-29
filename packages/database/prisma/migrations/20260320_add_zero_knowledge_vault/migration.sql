-- CreateTable
CREATE TABLE "user_zk_vaults" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "salt" TEXT NOT NULL,
    "pinHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_zk_vaults_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "secure_items" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "itemType" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "encryptedData" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "authTag" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "secure_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_zk_vaults_userId_key" ON "user_zk_vaults"("userId");

-- CreateIndex
CREATE INDEX "secure_items_userId_itemType_idx" ON "secure_items"("userId", "itemType");

-- AddForeignKey
ALTER TABLE "user_zk_vaults" ADD CONSTRAINT "user_zk_vaults_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "secure_items" ADD CONSTRAINT "secure_items_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
