CREATE TABLE "force_refresh" (
	"id" text PRIMARY KEY NOT NULL,
	"agency_id" text NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sync_run" ADD COLUMN "force_refresh_id" text;--> statement-breakpoint
ALTER TABLE "force_refresh" ADD CONSTRAINT "force_refresh_agency_id_organization_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "force_refresh_agency_requested_idx" ON "force_refresh" USING btree ("agency_id","requested_at");--> statement-breakpoint
CREATE INDEX "sync_run_force_refresh_idx" ON "sync_run" USING btree ("force_refresh_id");