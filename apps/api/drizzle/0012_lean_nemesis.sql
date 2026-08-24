ALTER TABLE "ad_account" ADD COLUMN "historical_reconciliation_attempted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ad_account" ADD COLUMN "historical_reconciliation_successful_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ad_account" ADD COLUMN "historical_reconciliation_date" date;--> statement-breakpoint
ALTER TABLE "ad_account" ADD COLUMN "historical_reconciliation_pending_date" date;--> statement-breakpoint
ALTER TABLE "ad_account" ADD COLUMN "historical_reconciliation_error" text;--> statement-breakpoint
ALTER TABLE "ad_account" ADD COLUMN "historical_reconciliation_diagnostic_reference" text;--> statement-breakpoint
ALTER TABLE "ad_account" ADD COLUMN "historical_reconciliation_lease_owner" text;--> statement-breakpoint
ALTER TABLE "ad_account" ADD COLUMN "historical_reconciliation_lease_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sync_account_outcome" ADD COLUMN "reconciliation_date" date;