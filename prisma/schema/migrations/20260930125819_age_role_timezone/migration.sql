-- CreateEnum
CREATE TYPE "Role" AS ENUM ('member', 'mentor', 'moderator', 'admin');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "birth_date" DATE,
ADD COLUMN     "role" "Role" NOT NULL DEFAULT 'member',
ADD COLUMN     "timezone" TEXT;
