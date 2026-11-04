-- CreateEnum
CREATE TYPE "WindowStatus" AS ENUM ('scheduled', 'open', 'closed', 'published');

-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('draft', 'submitted', 'under_review', 'shortlisted', 'waitlisted', 'accepted', 'declined', 'withdrawn');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('onboarding', 'active', 'on_leave', 'inactive', 'alumni', 'removed');

-- CreateEnum
CREATE TYPE "QuestionSource" AS ENUM ('fixed', 'ai', 'fallback');

-- CreateEnum
CREATE TYPE "ReviewKind" AS ENUM ('first', 'second');

-- CreateEnum
CREATE TYPE "ReviewRecommendation" AS ENUM ('accept', 'decline', 'waitlist', 'shortlist');

-- CreateEnum
CREATE TYPE "ClarificationStatus" AS ENUM ('open', 'answered', 'expired');

-- CreateEnum
CREATE TYPE "ConsentStatus" AS ENUM ('pending', 'confirmed', 'withdrawn', 'expired');

-- CreateEnum
CREATE TYPE "InviteRole" AS ENUM ('member', 'tutor', 'partner');

-- CreateEnum
CREATE TYPE "InviteSource" AS ENUM ('application', 'admin');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "existing_member" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "membership_status" "MembershipStatus" NOT NULL DEFAULT 'active',
ADD COLUMN     "onboarding_due_at" TIMESTAMP(3),
ADD COLUMN     "status_changed_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "application_windows" (
    "id" TEXT NOT NULL,
    "opens_at" TIMESTAMP(3) NOT NULL,
    "closes_at" TIMESTAMP(3) NOT NULL,
    "decisions_publish_at" TIMESTAMP(3) NOT NULL,
    "target_size" INTEGER,
    "status" "WindowStatus" NOT NULL DEFAULT 'scheduled',
    "form_version" TEXT NOT NULL,
    "note" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "application_windows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "applications" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "window_id" TEXT NOT NULL,
    "status" "ApplicationStatus" NOT NULL DEFAULT 'draft',
    "email" TEXT NOT NULL,
    "email_verified_at" TIMESTAMP(3),
    "full_name" TEXT NOT NULL,
    "birth_date" DATE NOT NULL,
    "country" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "whatsapp" TEXT NOT NULL,
    "school" TEXT,
    "education_level" TEXT NOT NULL,
    "interests" TEXT[],
    "skill_level" TEXT,
    "skill_level_note" TEXT,
    "current_skills" TEXT[],
    "learning_goals" TEXT[],
    "portfolio_url" TEXT,
    "github_url" TEXT,
    "linkedin_url" TEXT,
    "resume_token_hash" TEXT,
    "resume_expires_at" TIMESTAMP(3),
    "submitted_at" TIMESTAMP(3),
    "claimed_by" TEXT,
    "claimed_at" TIMESTAMP(3),
    "locked_at" TIMESTAMP(3),
    "second_reviewer_id" TEXT,
    "decided_by" TEXT,
    "decided_at" TIMESTAMP(3),
    "published_at" TIMESTAMP(3),
    "decision_note" TEXT,
    "decline_feedback" TEXT,
    "withdrawn_at" TIMESTAMP(3),
    "ai_summary" JSONB,
    "ip_hash" TEXT,
    "retention_delete_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "application_answers" (
    "id" TEXT NOT NULL,
    "application_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "question_key" TEXT NOT NULL,
    "question_text" TEXT NOT NULL,
    "source" "QuestionSource" NOT NULL,
    "prompt_version" TEXT,
    "format" TEXT NOT NULL,
    "criterion" TEXT,
    "answer" JSONB,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "application_answers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "application_answer_revisions" (
    "id" TEXT NOT NULL,
    "answer_id" TEXT NOT NULL,
    "answer" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "application_answer_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "application_attachments" (
    "id" TEXT NOT NULL,
    "application_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "url" TEXT,
    "public_id" TEXT,
    "filename" TEXT,
    "mime_type" TEXT,
    "size_bytes" INTEGER,
    "scan_status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "application_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "application_reviews" (
    "id" TEXT NOT NULL,
    "application_id" TEXT NOT NULL,
    "reviewer_id" TEXT NOT NULL,
    "kind" "ReviewKind" NOT NULL DEFAULT 'first',
    "scores" JSONB,
    "weighted_score" DOUBLE PRECISION,
    "recommendation" "ReviewRecommendation",
    "note" TEXT,
    "ai_suggestion" JSONB,
    "submitted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "application_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "application_clarifications" (
    "id" TEXT NOT NULL,
    "application_id" TEXT NOT NULL,
    "asked_by" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "due_at" TIMESTAMP(3) NOT NULL,
    "response" TEXT,
    "responded_at" TIMESTAMP(3),
    "status" "ClarificationStatus" NOT NULL DEFAULT 'open',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "application_clarifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guardian_consents" (
    "id" TEXT NOT NULL,
    "application_id" TEXT NOT NULL,
    "parent_email" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "text_version" TEXT NOT NULL,
    "status" "ConsentStatus" NOT NULL DEFAULT 'pending',
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "confirmed_at" TIMESTAMP(3),
    "withdrawn_at" TIMESTAMP(3),
    "ip_hash" TEXT,

    CONSTRAINT "guardian_consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitations" (
    "id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "InviteRole" NOT NULL DEFAULT 'member',
    "source" "InviteSource" NOT NULL,
    "application_id" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "used_by" TEXT,
    "revoked_at" TIMESTAMP(3),
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onboarding_progress" (
    "user_id" TEXT NOT NULL,
    "step" TEXT NOT NULL,
    "completed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "onboarding_progress_pkey" PRIMARY KEY ("user_id","step")
);

-- CreateTable
CREATE TABLE "membership_events" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "from_status" "MembershipStatus",
    "to_status" "MembershipStatus" NOT NULL,
    "reason" TEXT,
    "actor_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "membership_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "application_reminders" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "window_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMP(3),

    CONSTRAINT "application_reminders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "application_windows_opens_at_idx" ON "application_windows"("opens_at");

-- CreateIndex
CREATE UNIQUE INDEX "applications_reference_key" ON "applications"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "applications_resume_token_hash_key" ON "applications"("resume_token_hash");

-- CreateIndex
CREATE INDEX "applications_window_id_status_idx" ON "applications"("window_id", "status");

-- CreateIndex
CREATE INDEX "applications_claimed_by_idx" ON "applications"("claimed_by");

-- CreateIndex
CREATE INDEX "applications_retention_delete_at_idx" ON "applications"("retention_delete_at");

-- CreateIndex
CREATE UNIQUE INDEX "applications_email_window_id_key" ON "applications"("email", "window_id");

-- CreateIndex
CREATE UNIQUE INDEX "application_answers_application_id_position_key" ON "application_answers"("application_id", "position");

-- CreateIndex
CREATE INDEX "application_answer_revisions_answer_id_idx" ON "application_answer_revisions"("answer_id");

-- CreateIndex
CREATE INDEX "application_attachments_application_id_idx" ON "application_attachments"("application_id");

-- CreateIndex
CREATE UNIQUE INDEX "application_reviews_application_id_reviewer_id_key" ON "application_reviews"("application_id", "reviewer_id");

-- CreateIndex
CREATE INDEX "application_clarifications_application_id_status_idx" ON "application_clarifications"("application_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "guardian_consents_application_id_key" ON "guardian_consents"("application_id");

-- CreateIndex
CREATE UNIQUE INDEX "guardian_consents_token_hash_key" ON "guardian_consents"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "invitations_token_hash_key" ON "invitations"("token_hash");

-- CreateIndex
CREATE INDEX "invitations_email_idx" ON "invitations"("email");

-- CreateIndex
CREATE INDEX "membership_events_user_id_created_at_idx" ON "membership_events"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "application_reminders_email_window_id_key" ON "application_reminders"("email", "window_id");

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_window_id_fkey" FOREIGN KEY ("window_id") REFERENCES "application_windows"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_answers" ADD CONSTRAINT "application_answers_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_answer_revisions" ADD CONSTRAINT "application_answer_revisions_answer_id_fkey" FOREIGN KEY ("answer_id") REFERENCES "application_answers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_attachments" ADD CONSTRAINT "application_attachments_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_reviews" ADD CONSTRAINT "application_reviews_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_clarifications" ADD CONSTRAINT "application_clarifications_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guardian_consents" ADD CONSTRAINT "guardian_consents_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_progress" ADD CONSTRAINT "onboarding_progress_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_reminders" ADD CONSTRAINT "application_reminders_window_id_fkey" FOREIGN KEY ("window_id") REFERENCES "application_windows"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Everyone who joined before admissions existed keeps their access: they are active (the column
-- default) and marked as grandfathered.
UPDATE "users" SET "existing_member" = true;
