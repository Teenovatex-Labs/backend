-- CreateTable
CREATE TABLE "pet_memories" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pet_memories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pet_memories_user_id_created_at_idx" ON "pet_memories"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "pet_memories" ADD CONSTRAINT "pet_memories_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

