-- AlterTable
ALTER TABLE "sessions" ADD COLUMN     "prev_token_hash" TEXT,
ADD COLUMN     "rotated_at" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "sessions_prev_token_hash_key" ON "sessions"("prev_token_hash");

