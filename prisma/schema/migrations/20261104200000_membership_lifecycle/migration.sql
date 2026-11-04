-- CreateEnum
CREATE TYPE "InactivityReviewStatus" AS ENUM ('open', 'decided');

-- CreateTable
CREATE TABLE "inactivity_reviews" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "status" "InactivityReviewStatus" NOT NULL DEFAULT 'open',
    "reason" TEXT NOT NULL,
    "started_by" TEXT NOT NULL,
    "response_due_at" TIMESTAMP(3) NOT NULL,
    "member_response" TEXT,
    "responded_at" TIMESTAMP(3),
    "decision" "MembershipStatus",
    "decision_reason" TEXT,
    "decided_by" TEXT,
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inactivity_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "inactivity_reviews_user_id_status_idx" ON "inactivity_reviews"("user_id", "status");

-- AddForeignKey
ALTER TABLE "inactivity_reviews" ADD CONSTRAINT "inactivity_reviews_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

