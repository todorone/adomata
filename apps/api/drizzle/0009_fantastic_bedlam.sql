CREATE TABLE "sync_account_outcome" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"ad_account_id" text NOT NULL,
	"slice" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"attempted_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"successful_commit_at" timestamp with time zone,
	"diagnostic_reference" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_invocation" (
	"id" text PRIMARY KEY NOT NULL,
	"agency_id" text NOT NULL,
	"run_id" text NOT NULL,
	"trigger" text NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_run" (
	"id" text PRIMARY KEY NOT NULL,
	"agency_id" text NOT NULL,
	"trigger" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"diagnostic_reference" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ad_account" ADD COLUMN "account_data_attempted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ad_account" ADD COLUMN "account_data_successful_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ad_account" ADD COLUMN "account_data_error" text;--> statement-breakpoint
ALTER TABLE "ad_account" ADD COLUMN "account_data_diagnostic_reference" text;--> statement-breakpoint
ALTER TABLE "ad_account" ADD COLUMN "account_data_next_due_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "ad_account" ADD COLUMN "account_data_lease_owner" text;--> statement-breakpoint
ALTER TABLE "ad_account" ADD COLUMN "account_data_lease_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sync_account_outcome" ADD CONSTRAINT "sync_account_outcome_run_id_sync_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."sync_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_account_outcome" ADD CONSTRAINT "sync_account_outcome_ad_account_id_ad_account_id_fk" FOREIGN KEY ("ad_account_id") REFERENCES "public"."ad_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_invocation" ADD CONSTRAINT "sync_invocation_agency_id_organization_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_invocation" ADD CONSTRAINT "sync_invocation_run_id_sync_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."sync_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_run" ADD CONSTRAINT "sync_run_agency_id_organization_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sync_account_outcome_run_account_slice_idx" ON "sync_account_outcome" USING btree ("run_id","ad_account_id","slice");--> statement-breakpoint
CREATE INDEX "sync_account_outcome_lease_idx" ON "sync_account_outcome" USING btree ("status","lease_expires_at");--> statement-breakpoint
CREATE INDEX "sync_account_outcome_account_created_idx" ON "sync_account_outcome" USING btree ("ad_account_id","created_at");--> statement-breakpoint
CREATE INDEX "sync_invocation_agency_received_idx" ON "sync_invocation" USING btree ("agency_id","received_at");--> statement-breakpoint
CREATE INDEX "sync_run_agency_created_idx" ON "sync_run" USING btree ("agency_id","created_at");--> statement-breakpoint
CREATE INDEX "sync_run_lease_idx" ON "sync_run" USING btree ("status","lease_expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sync_run_active_agency_idx" ON "sync_run" USING btree ("agency_id") WHERE "sync_run"."status" in ('queued', 'running');