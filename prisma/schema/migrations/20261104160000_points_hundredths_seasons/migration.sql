-- Points become whole hundredths (old value * 100) and are counted per season. Lossless: old = new / 100.
CREATE TABLE "seasons" (
    "id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "starts_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ends_at" TIMESTAMP(3),
    "is_current" BOOLEAN NOT NULL DEFAULT false,
    "created_by" TEXT,
    CONSTRAINT "seasons_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "season_totals" (
    "user_id" TEXT NOT NULL,
    "season_id" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    CONSTRAINT "season_totals_pkey" PRIMARY KEY ("user_id", "season_id")
);

ALTER TABLE "points_log" ADD COLUMN "season_id" TEXT;

CREATE UNIQUE INDEX "seasons_number_key" ON "seasons"("number");
CREATE INDEX "season_totals_season_id_idx" ON "season_totals"("season_id");
CREATE INDEX "points_log_season_id_idx" ON "points_log"("season_id");

ALTER TABLE "season_totals" ADD CONSTRAINT "season_totals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "season_totals" ADD CONSTRAINT "season_totals_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "seasons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "points_log" ADD CONSTRAINT "points_log_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "seasons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Everything earned so far is Season 0 (legacy), which stays the current season until an admin starts the next one.
INSERT INTO "seasons" ("id", "number", "name", "is_current") VALUES (gen_random_uuid()::text, 0, 'Season 0 (legacy)', true);

UPDATE "users" SET "points" = "points" * 100;
UPDATE "points_log" SET "points" = "points" * 100, "season_id" = (SELECT "id" FROM "seasons" WHERE "number" = 0);
