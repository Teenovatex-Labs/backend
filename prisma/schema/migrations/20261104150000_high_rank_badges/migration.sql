-- High-rank honours, separate from the automatic activity badges. Additive: nothing existing changes.
CREATE TYPE "BadgeTier" AS ENUM ('standard', 'high', 'top');
CREATE TYPE "BadgeImageKind" AS ENUM ('svg', 'png', 'webp');

CREATE TABLE "badge_definitions" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "tier" "BadgeTier" NOT NULL DEFAULT 'high',
    "criteria_text" TEXT NOT NULL,
    "image_kind" "BadgeImageKind",
    "image_url" TEXT,
    "svg_source" TEXT,
    "fallback_url" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "repeatable" BOOLEAN NOT NULL DEFAULT false,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "badge_definitions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "badge_awards" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "badge_id" TEXT NOT NULL,
    "awarded_by" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "challenge_id" TEXT,
    "awarded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),
    "revoked_by" TEXT,
    "revoke_reason" TEXT,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "badge_awards_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "badge_definitions_slug_key" ON "badge_definitions"("slug");
CREATE INDEX "badge_awards_user_id_idx" ON "badge_awards"("user_id");
CREATE INDEX "badge_awards_badge_id_idx" ON "badge_awards"("badge_id");

ALTER TABLE "badge_awards" ADD CONSTRAINT "badge_awards_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "badge_awards" ADD CONSTRAINT "badge_awards_badge_id_fkey" FOREIGN KEY ("badge_id") REFERENCES "badge_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
