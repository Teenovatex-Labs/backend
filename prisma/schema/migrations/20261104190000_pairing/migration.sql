-- CreateEnum
CREATE TYPE "PairingKind" AS ENUM ('pair', 'trio');

-- CreateEnum
CREATE TYPE "PairingStatus" AS ENUM ('proposed', 'active', 'closed', 'cancelled');

-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "pairing_id" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "interests" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "safeguarding_cleared_at" TIMESTAMP(3),
ADD COLUMN     "safeguarding_cleared_by" TEXT,
ADD COLUMN     "skills" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "pairings" (
    "id" TEXT NOT NULL,
    "kind" "PairingKind" NOT NULL DEFAULT 'pair',
    "goal" TEXT NOT NULL,
    "rationale" TEXT,
    "status" "PairingStatus" NOT NULL DEFAULT 'proposed',
    "supervised" BOOLEAN NOT NULL DEFAULT false,
    "supervisor_id" TEXT,
    "starts_on" DATE,
    "ends_on" DATE NOT NULL,
    "created_by" TEXT NOT NULL,
    "approved_by" TEXT,
    "second_approved_by" TEXT,
    "closed_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pairings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pairing_members" (
    "pairing_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,

    CONSTRAINT "pairing_members_pkey" PRIMARY KEY ("pairing_id","user_id")
);

-- CreateIndex
CREATE INDEX "pairings_status_idx" ON "pairings"("status");

-- CreateIndex
CREATE INDEX "pairing_members_user_id_idx" ON "pairing_members"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "conversations_pairing_id_key" ON "conversations"("pairing_id");

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_pairing_id_fkey" FOREIGN KEY ("pairing_id") REFERENCES "pairings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pairing_members" ADD CONSTRAINT "pairing_members_pairing_id_fkey" FOREIGN KEY ("pairing_id") REFERENCES "pairings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pairing_members" ADD CONSTRAINT "pairing_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

