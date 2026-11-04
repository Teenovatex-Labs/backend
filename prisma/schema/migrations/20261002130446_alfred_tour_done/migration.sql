-- AlterTable
ALTER TABLE "settings" ADD COLUMN     "alfred_tour_done_at" TIMESTAMP(3);


-- Everyone who is already here has had the welcome; do not show it to them again.
UPDATE "settings" SET "alfred_tour_done_at" = NOW();
