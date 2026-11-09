-- A test admissions window is a rehearsal: private link, no real emails, no real accounts, easy to purge.
ALTER TABLE "application_windows" ADD COLUMN "is_test" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "application_windows" ADD COLUMN "test_key" TEXT;
CREATE UNIQUE INDEX "application_windows_test_key_key" ON "application_windows"("test_key");
CREATE INDEX "application_windows_is_test_idx" ON "application_windows"("is_test");
