-- AlterTable
ALTER TABLE "store_contexts" ADD COLUMN IF NOT EXISTS "pendingProduct" JSONB;
