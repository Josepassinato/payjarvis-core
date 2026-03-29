-- AlterTable: add shipping_address to users
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "shipping_address" TEXT;
