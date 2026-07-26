ALTER TABLE "ad_account" ADD COLUMN "timezone_name" text;--> statement-breakpoint
ALTER TABLE "ad_account" ADD COLUMN "insights_tier_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ad_account" ADD COLUMN "insights_tier_error" text;--> statement-breakpoint
ALTER TABLE "ad_insight" ADD COLUMN "inline_link_clicks" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ad_set" ADD COLUMN "result_action_type" text;--> statement-breakpoint
CREATE INDEX "ad_insight_date_ad_id_idx" ON "ad_insight" USING btree ("date","ad_id");