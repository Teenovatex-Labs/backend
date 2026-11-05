ALTER TABLE "applications" ADD COLUMN "waitlist_offer_hash" TEXT;
ALTER TABLE "applications" ADD COLUMN "waitlist_offer_sent_at" TIMESTAMP(3);
ALTER TABLE "applications" ADD COLUMN "waitlist_offer_expires_at" TIMESTAMP(3);
ALTER TABLE "applications" ADD COLUMN "waitlist_offer_response" TEXT;
CREATE UNIQUE INDEX "applications_waitlist_offer_hash_key" ON "applications"("waitlist_offer_hash");
