DROP INDEX "sync_run_active_agency_idx";--> statement-breakpoint
ALTER TABLE "ad_account" ADD COLUMN "hierarchy_attempted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ad_account" ADD COLUMN "hierarchy_successful_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ad_account" ADD COLUMN "hierarchy_error" text;--> statement-breakpoint
ALTER TABLE "ad_account" ADD COLUMN "hierarchy_diagnostic_reference" text;--> statement-breakpoint
ALTER TABLE "ad_account" ADD COLUMN "hierarchy_next_due_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "ad_account" ADD COLUMN "hierarchy_lease_owner" text;--> statement-breakpoint
ALTER TABLE "ad_account" ADD COLUMN "hierarchy_lease_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sync_run" ADD COLUMN "slice" text DEFAULT 'account_data' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "sync_run_active_agency_slice_idx" ON "sync_run" USING btree ("agency_id","slice") WHERE "sync_run"."status" in ('queued', 'running');