ALTER TABLE "ad_account" ADD COLUMN "initial_import_history_completed_at" timestamp with time zone;
UPDATE "ad_account"
SET "initial_import_history_completed_at" = "insights_successful_at"
WHERE "connection_status" IN ('connected', 'access_lost')
	AND "insights_successful_at" IS NOT NULL;
