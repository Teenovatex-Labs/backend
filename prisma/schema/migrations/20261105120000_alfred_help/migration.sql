ALTER TABLE "application_answers" ADD COLUMN "hint_used" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "application_answers" ADD COLUMN "alternatives" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "applications" ADD COLUMN "alfred_skips" INTEGER NOT NULL DEFAULT 0;
