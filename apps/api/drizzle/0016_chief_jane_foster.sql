UPDATE "ad_account"
SET
	"account_data_attempted_at" = COALESCE("account_data_attempted_at", "last_poll_attempt_at"),
	"account_data_successful_at" = COALESCE("account_data_successful_at", "account_tier_refreshed_at"),
	"account_data_error" = COALESCE("account_data_error", "last_poll_error"),
	"insights_attempted_at" = COALESCE("insights_attempted_at", "insights_tier_attempt_at"),
	"insights_successful_at" = COALESCE("insights_successful_at", "insights_tier_refreshed_at"),
	"insights_error" = COALESCE("insights_error", "insights_tier_error");--> statement-breakpoint
ALTER TABLE "ad_account" DROP COLUMN "last_poll_attempt_at";--> statement-breakpoint
ALTER TABLE "ad_account" DROP COLUMN "last_poll_error";--> statement-breakpoint
ALTER TABLE "ad_account" DROP COLUMN "insights_tier_attempt_at";--> statement-breakpoint
ALTER TABLE "ad_account" DROP COLUMN "insights_tier_error";--> statement-breakpoint
ALTER TABLE "ad_account" DROP COLUMN "account_tier_refreshed_at";--> statement-breakpoint
ALTER TABLE "ad_account" DROP COLUMN "insights_tier_refreshed_at";
