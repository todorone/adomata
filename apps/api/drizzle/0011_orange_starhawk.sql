ALTER TABLE "ad_account" ADD COLUMN "insights_attempted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ad_account" ADD COLUMN "insights_successful_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ad_account" ADD COLUMN "insights_error" text;--> statement-breakpoint
ALTER TABLE "ad_account" ADD COLUMN "insights_diagnostic_reference" text;--> statement-breakpoint
ALTER TABLE "ad_account" ADD COLUMN "insights_next_due_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "ad_account" ADD COLUMN "insights_lease_owner" text;--> statement-breakpoint
ALTER TABLE "ad_account" ADD COLUMN "insights_lease_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ad_account" ADD COLUMN "creative_attempted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ad_account" ADD COLUMN "creative_successful_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ad_account" ADD COLUMN "creative_error" text;--> statement-breakpoint
ALTER TABLE "ad_account" ADD COLUMN "creative_diagnostic_reference" text;--> statement-breakpoint
ALTER TABLE "ad_account" ADD COLUMN "creative_next_due_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "ad_account" ADD COLUMN "creative_lease_owner" text;--> statement-breakpoint
ALTER TABLE "ad_account" ADD COLUMN "creative_lease_expires_at" timestamp with time zone;--> statement-breakpoint

UPDATE "ad_account"
SET
	"insights_attempted_at" = "insights_tier_attempt_at",
	"insights_successful_at" = "insights_tier_refreshed_at",
	"insights_error" = "insights_tier_error",
	"insights_next_due_at" = now()
WHERE "insights_tier_attempt_at" IS NOT NULL OR "insights_tier_refreshed_at" IS NOT NULL OR "insights_tier_error" IS NOT NULL;
