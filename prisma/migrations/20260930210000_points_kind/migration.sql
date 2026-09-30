-- CreateEnum
CREATE TYPE "PointsKind" AS ENUM ('vote_received', 'vote_removed', 'lesson', 'streak', 'streak_milestone', 'post_tagged', 'other');

-- AlterTable
ALTER TABLE "points_log" ADD COLUMN     "kind" "PointsKind" NOT NULL DEFAULT 'other';


-- Give existing rows their proper kind, based on the wording the old code used.
UPDATE "points_log" SET "kind" = 'vote_received' WHERE "reason" ILIKE 'Vote received%';
UPDATE "points_log" SET "kind" = 'vote_removed' WHERE "reason" ILIKE 'Vote removed%';
UPDATE "points_log" SET "kind" = 'lesson' WHERE "reason" ILIKE 'Finished lesson%';
UPDATE "points_log" SET "kind" = 'streak_milestone' WHERE "reason" ILIKE '%streak milestone%';
UPDATE "points_log" SET "kind" = 'streak' WHERE "reason" = 'Daily login streak';
UPDATE "points_log" SET "kind" = 'post_tagged' WHERE "reason" = 'Posted update and tagged TX';
