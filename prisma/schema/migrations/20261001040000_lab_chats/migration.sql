-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "lab_id" TEXT,
ALTER COLUMN "pair_key" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "conversations_lab_id_key" ON "conversations"("lab_id");

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_lab_id_fkey" FOREIGN KEY ("lab_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

