-- AlterTable
ALTER TABLE "settings" ADD COLUMN     "ai_chat" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "ai_consented_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "pet_usage" (
    "user_id" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "pet_usage_pkey" PRIMARY KEY ("user_id","day")
);

