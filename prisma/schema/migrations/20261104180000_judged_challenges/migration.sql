-- CreateEnum
CREATE TYPE "ChallengeKind" AS ENUM ('weekly', 'monthly', 'special');

-- CreateEnum
CREATE TYPE "ChallengeStatus" AS ENUM ('draft', 'open', 'judging', 'closed');

-- CreateEnum
CREATE TYPE "ChallengeEntryStatus" AS ENUM ('submitted', 'withdrawn', 'disqualified');

-- AlterEnum
ALTER TYPE "PointsKind" ADD VALUE 'challenge';

-- CreateTable
CREATE TABLE "challenges" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "rules" TEXT NOT NULL,
    "kind" "ChallengeKind" NOT NULL DEFAULT 'special',
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "judging_ends_at" TIMESTAMP(3) NOT NULL,
    "status" "ChallengeStatus" NOT NULL DEFAULT 'draft',
    "criteria" JSONB NOT NULL,
    "badge_id" TEXT,
    "entry_limit" INTEGER NOT NULL DEFAULT 1,
    "results_published_at" TIMESTAMP(3),
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "challenge_entries" (
    "id" TEXT NOT NULL,
    "challenge_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "links" JSONB NOT NULL DEFAULT '[]',
    "status" "ChallengeEntryStatus" NOT NULL DEFAULT 'submitted',
    "dq_reason" TEXT,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "challenge_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "challenge_scores" (
    "id" TEXT NOT NULL,
    "entry_id" TEXT NOT NULL,
    "judge_id" TEXT NOT NULL,
    "scores" JSONB NOT NULL,
    "total" INTEGER NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "challenge_scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "challenge_results" (
    "id" TEXT NOT NULL,
    "challenge_id" TEXT NOT NULL,
    "entry_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "place" INTEGER NOT NULL,
    "total" INTEGER NOT NULL,
    "published_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "challenge_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "challenges_status_idx" ON "challenges"("status");

-- CreateIndex
CREATE INDEX "challenge_entries_challenge_id_user_id_idx" ON "challenge_entries"("challenge_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "challenge_scores_entry_id_judge_id_key" ON "challenge_scores"("entry_id", "judge_id");

-- CreateIndex
CREATE UNIQUE INDEX "challenge_results_challenge_id_entry_id_key" ON "challenge_results"("challenge_id", "entry_id");

-- AddForeignKey
ALTER TABLE "challenges" ADD CONSTRAINT "challenges_badge_id_fkey" FOREIGN KEY ("badge_id") REFERENCES "badge_definitions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "challenge_entries" ADD CONSTRAINT "challenge_entries_challenge_id_fkey" FOREIGN KEY ("challenge_id") REFERENCES "challenges"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "challenge_entries" ADD CONSTRAINT "challenge_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "challenge_scores" ADD CONSTRAINT "challenge_scores_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "challenge_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "challenge_results" ADD CONSTRAINT "challenge_results_challenge_id_fkey" FOREIGN KEY ("challenge_id") REFERENCES "challenges"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "challenge_results" ADD CONSTRAINT "challenge_results_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "challenge_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "badge_awards" ADD CONSTRAINT "badge_awards_challenge_id_fkey" FOREIGN KEY ("challenge_id") REFERENCES "challenges"("id") ON DELETE SET NULL ON UPDATE CASCADE;

