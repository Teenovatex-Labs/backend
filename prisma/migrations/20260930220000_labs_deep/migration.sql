-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('backlog', 'in_progress', 'testing', 'done');

-- CreateEnum
CREATE TYPE "LabRole" AS ENUM ('owner', 'member');

-- CreateEnum
CREATE TYPE "JoinStatus" AS ENUM ('pending', 'accepted', 'declined');

-- AlterTable
ALTER TABLE "event_rsvps" ADD COLUMN     "reminded_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "lab_updates" (
    "id" TEXT NOT NULL,
    "lab_id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lab_updates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_tasks" (
    "id" TEXT NOT NULL,
    "lab_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "notes" TEXT,
    "status" "TaskStatus" NOT NULL DEFAULT 'backlog',
    "position" INTEGER NOT NULL DEFAULT 0,
    "assignee_id" TEXT,
    "due_at" TIMESTAMP(3),
    "reminded_at" TIMESTAMP(3),
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "done_at" TIMESTAMP(3),

    CONSTRAINT "lab_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_milestones" (
    "id" TEXT NOT NULL,
    "lab_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "due_at" TIMESTAMP(3),
    "done_at" TIMESTAMP(3),
    "reminded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lab_milestones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_members" (
    "lab_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" "LabRole" NOT NULL DEFAULT 'member',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lab_members_pkey" PRIMARY KEY ("lab_id","user_id")
);

-- CreateTable
CREATE TABLE "lab_join_requests" (
    "id" TEXT NOT NULL,
    "lab_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "message" TEXT,
    "status" "JoinStatus" NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lab_join_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lab_updates_lab_id_created_at_idx" ON "lab_updates"("lab_id", "created_at");

-- CreateIndex
CREATE INDEX "lab_tasks_lab_id_status_position_idx" ON "lab_tasks"("lab_id", "status", "position");

-- CreateIndex
CREATE INDEX "lab_tasks_due_at_idx" ON "lab_tasks"("due_at");

-- CreateIndex
CREATE INDEX "lab_milestones_lab_id_idx" ON "lab_milestones"("lab_id");

-- CreateIndex
CREATE INDEX "lab_milestones_due_at_idx" ON "lab_milestones"("due_at");

-- CreateIndex
CREATE INDEX "lab_members_user_id_idx" ON "lab_members"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "lab_join_requests_lab_id_user_id_key" ON "lab_join_requests"("lab_id", "user_id");

-- AddForeignKey
ALTER TABLE "lab_updates" ADD CONSTRAINT "lab_updates_lab_id_fkey" FOREIGN KEY ("lab_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_tasks" ADD CONSTRAINT "lab_tasks_lab_id_fkey" FOREIGN KEY ("lab_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_milestones" ADD CONSTRAINT "lab_milestones_lab_id_fkey" FOREIGN KEY ("lab_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_members" ADD CONSTRAINT "lab_members_lab_id_fkey" FOREIGN KEY ("lab_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_members" ADD CONSTRAINT "lab_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_join_requests" ADD CONSTRAINT "lab_join_requests_lab_id_fkey" FOREIGN KEY ("lab_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_join_requests" ADD CONSTRAINT "lab_join_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Every existing lab's creator becomes its owner-member, so they show up on the team.
INSERT INTO "lab_members" ("lab_id", "user_id", "role")
SELECT "id", "user_id", 'owner' FROM "projects"
ON CONFLICT DO NOTHING;
