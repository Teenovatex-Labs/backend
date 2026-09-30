-- Notifications can say where they lead and carry extra data.
ALTER TABLE "notifications" ADD COLUMN "link" TEXT,
ADD COLUMN "payload" JSONB;

-- One vote per member per project per day, enforced by the database.
-- Existing votes are stamped with their UTC day; where that produced two votes on the
-- same day, the later duplicates are dropped so the unique index can be built.
ALTER TABLE "votes" ADD COLUMN "vote_day" DATE;
UPDATE "votes" SET "vote_day" = ("voted_at" AT TIME ZONE 'UTC')::date;

DELETE FROM "votes" v USING (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "user_id", "project_id", "vote_day" ORDER BY "voted_at") AS rn
  FROM "votes"
) d WHERE v."id" = d."id" AND d.rn > 1;

UPDATE "projects" p SET "vote_count" = COALESCE((SELECT COUNT(*) FROM "votes" v WHERE v."project_id" = p."id"), 0);

ALTER TABLE "votes" ALTER COLUMN "vote_day" SET NOT NULL;
CREATE UNIQUE INDEX "votes_user_id_project_id_vote_day_key" ON "votes"("user_id", "project_id", "vote_day");
