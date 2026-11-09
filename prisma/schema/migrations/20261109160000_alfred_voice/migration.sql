-- Alfred's reactions, follow-ups and tone. All additive and nullable or defaulted.
ALTER TABLE "applications" ADD COLUMN "alfred_tone" TEXT NOT NULL DEFAULT 'balanced';
ALTER TABLE "application_answers" ADD COLUMN "lead_in_type" TEXT,
ADD COLUMN "lead_in_text" TEXT,
ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'new',
ADD COLUMN "signals" JSONB;
