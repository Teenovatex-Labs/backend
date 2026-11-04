-- AlterEnum
ALTER TYPE "PointsKind" ADD VALUE 'quest';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "streak_freezes" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "user_badges" (
    "user_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "awarded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_badges_pkey" PRIMARY KEY ("user_id","key")
);

-- CreateTable
CREATE TABLE "quest_claims" (
    "user_id" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "key" TEXT NOT NULL,
    "claimed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quest_claims_pkey" PRIMARY KEY ("user_id","day")
);

-- AddForeignKey
ALTER TABLE "user_badges" ADD CONSTRAINT "user_badges_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

