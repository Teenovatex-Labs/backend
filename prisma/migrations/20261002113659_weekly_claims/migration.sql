-- CreateTable
CREATE TABLE "weekly_claims" (
    "user_id" TEXT NOT NULL,
    "week" DATE NOT NULL,
    "key" TEXT NOT NULL,
    "claimed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "weekly_claims_pkey" PRIMARY KEY ("user_id","week","key")
);

