CREATE TABLE "ad" (
	"id" text PRIMARY KEY NOT NULL,
	"ad_set_id" text NOT NULL,
	"name" text NOT NULL,
	"effective_status" text NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ad_account" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"name" text NOT NULL,
	"currency" text NOT NULL,
	"connection_status" text DEFAULT 'pending' NOT NULL,
	"last_poll_attempt_at" timestamp with time zone,
	"last_poll_error" text,
	"account_tier_refreshed_at" timestamp with time zone,
	"insights_tier_refreshed_at" timestamp with time zone,
	"meta_account_status" integer,
	"meta_disable_reason" integer,
	"balance" text,
	"is_prepay_account" boolean,
	"funding_source_type" integer,
	"health_color" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ad_creative" (
	"id" text PRIMARY KEY NOT NULL,
	"ad_id" text NOT NULL,
	"name" text,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ad_insight" (
	"ad_id" text NOT NULL,
	"date" date NOT NULL,
	"spend" text NOT NULL,
	"impressions" integer NOT NULL,
	"clicks" integer NOT NULL,
	"actions" jsonb NOT NULL,
	"action_values" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ad_insight_ad_id_date_pk" PRIMARY KEY("ad_id","date")
);
--> statement-breakpoint
CREATE TABLE "ad_set" (
	"id" text PRIMARY KEY NOT NULL,
	"campaign_id" text NOT NULL,
	"name" text NOT NULL,
	"effective_status" text NOT NULL,
	"optimization_goal" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign" (
	"id" text PRIMARY KEY NOT NULL,
	"ad_account_id" text NOT NULL,
	"name" text NOT NULL,
	"effective_status" text NOT NULL,
	"objective" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client" (
	"id" text PRIMARY KEY NOT NULL,
	"agency_id" text NOT NULL,
	"name" text NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ad" ADD CONSTRAINT "ad_ad_set_id_ad_set_id_fk" FOREIGN KEY ("ad_set_id") REFERENCES "public"."ad_set"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_account" ADD CONSTRAINT "ad_account_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_creative" ADD CONSTRAINT "ad_creative_ad_id_ad_id_fk" FOREIGN KEY ("ad_id") REFERENCES "public"."ad"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_insight" ADD CONSTRAINT "ad_insight_ad_id_ad_id_fk" FOREIGN KEY ("ad_id") REFERENCES "public"."ad"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_set" ADD CONSTRAINT "ad_set_campaign_id_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaign"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign" ADD CONSTRAINT "campaign_ad_account_id_ad_account_id_fk" FOREIGN KEY ("ad_account_id") REFERENCES "public"."ad_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client" ADD CONSTRAINT "client_agency_id_organization_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ad_ad_set_id_idx" ON "ad" USING btree ("ad_set_id");--> statement-breakpoint
CREATE INDEX "ad_account_client_id_idx" ON "ad_account" USING btree ("client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ad_creative_ad_id_idx" ON "ad_creative" USING btree ("ad_id");--> statement-breakpoint
CREATE INDEX "ad_set_campaign_id_idx" ON "ad_set" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "campaign_ad_account_id_idx" ON "campaign" USING btree ("ad_account_id");--> statement-breakpoint
CREATE INDEX "client_agency_id_idx" ON "client" USING btree ("agency_id");