CREATE TABLE "point_rules" (
    "key" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "daily_cap" INTEGER,
    "updated_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "point_rules_pkey" PRIMARY KEY ("key")
);
