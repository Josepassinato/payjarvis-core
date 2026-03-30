-- AlterTable
ALTER TABLE "shopping_lists" ADD COLUMN "approved_at" TIMESTAMP(3);
ALTER TABLE "shopping_lists" ADD COLUMN "approved_items" JSONB;
ALTER TABLE "shopping_lists" ADD COLUMN "rejected_items" JSONB;
ALTER TABLE "shopping_lists" ADD COLUMN "purchase_result" JSONB;
