ALTER TABLE "client" ADD COLUMN "meta_business_id" text;--> statement-breakpoint
CREATE INDEX "client_agency_business_idx" ON "client" USING btree ("agency_id","meta_business_id");