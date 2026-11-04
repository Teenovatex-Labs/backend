-- AlterTable
ALTER TABLE "users"
ADD COLUMN "reset_code_hash" TEXT,
ADD COLUMN "reset_code_expires_at" TIMESTAMP(3),
ADD COLUMN "reset_attempts" INTEGER NOT NULL DEFAULT 0;
