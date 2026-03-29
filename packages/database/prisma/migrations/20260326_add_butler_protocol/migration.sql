-- Butler Protocol 🎩

-- CreateTable
CREATE TABLE "butler_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fullName" TEXT,
    "email" TEXT,
    "address" TEXT,
    "phone" TEXT,
    "dateOfBirth" TEXT,
    "ssn" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "butler_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "butler_credentials" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "serviceName" TEXT NOT NULL,
    "serviceUrl" TEXT NOT NULL,
    "login" TEXT NOT NULL,
    "encryptedPassword" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsed" TIMESTAMP(3),

    CONSTRAINT "butler_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "butler_audit_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "service" TEXT,
    "status" TEXT NOT NULL,
    "details" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "butler_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "butler_profiles_userId_key" ON "butler_profiles"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "butler_credentials_userId_serviceName_key" ON "butler_credentials"("userId", "serviceName");

-- CreateIndex
CREATE INDEX "butler_credentials_userId_idx" ON "butler_credentials"("userId");

-- CreateIndex
CREATE INDEX "butler_audit_logs_userId_idx" ON "butler_audit_logs"("userId");

-- CreateIndex
CREATE INDEX "butler_audit_logs_createdAt_idx" ON "butler_audit_logs"("createdAt");

-- AddForeignKey
ALTER TABLE "butler_credentials" ADD CONSTRAINT "butler_credentials_userId_fkey" FOREIGN KEY ("userId") REFERENCES "butler_profiles"("userId") ON DELETE CASCADE ON UPDATE CASCADE;
