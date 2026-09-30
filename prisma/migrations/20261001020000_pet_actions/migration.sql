-- CreateTable
CREATE TABLE "pet_actions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "payload" JSONB,
    "undone_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pet_actions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pet_actions_user_id_created_at_idx" ON "pet_actions"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "pet_actions" ADD CONSTRAINT "pet_actions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

