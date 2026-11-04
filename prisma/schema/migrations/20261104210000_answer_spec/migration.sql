-- How a question is answered (choices, a scale, a slider). Null means a typed answer.
ALTER TABLE "application_answers" ADD COLUMN "spec" JSONB;
