ALTER TYPE "public"."monitor_type" ADD VALUE 'web_vitals';--> statement-breakpoint
CREATE TABLE "alert_channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"channel" "alert_channel" NOT NULL,
	"config" jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dns_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"monitor_id" uuid NOT NULL,
	"records" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "snoozed_monitors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"monitor_id" uuid NOT NULL,
	"expires_at" timestamp with time zone,
	"reason" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "web_vitals_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"monitor_id" uuid NOT NULL,
	"lcp_ms" integer,
	"fid_ms" integer,
	"cls" real,
	"fcp_ms" integer,
	"ttfb_ms" integer,
	"si_ms" integer,
	"ts" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "alert_channels" ALTER COLUMN "channel" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "alerts" ALTER COLUMN "channel" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."alert_channel";--> statement-breakpoint
CREATE TYPE "public"."alert_channel" AS ENUM('email', 'slack');--> statement-breakpoint
ALTER TABLE "alert_channels" ALTER COLUMN "channel" SET DATA TYPE "public"."alert_channel" USING "channel"::"public"."alert_channel";--> statement-breakpoint
ALTER TABLE "alerts" ALTER COLUMN "channel" SET DATA TYPE "public"."alert_channel" USING "channel"::"public"."alert_channel";--> statement-breakpoint
ALTER TABLE "monitor_events" ADD COLUMN "diff" jsonb DEFAULT NULL;--> statement-breakpoint
ALTER TABLE "monitors" ADD COLUMN "alert_config" jsonb DEFAULT NULL;--> statement-breakpoint
ALTER TABLE "alert_channels" ADD CONSTRAINT "alert_channels_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dns_snapshots" ADD CONSTRAINT "dns_snapshots_monitor_id_monitors_id_fk" FOREIGN KEY ("monitor_id") REFERENCES "public"."monitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snoozed_monitors" ADD CONSTRAINT "snoozed_monitors_monitor_id_monitors_id_fk" FOREIGN KEY ("monitor_id") REFERENCES "public"."monitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snoozed_monitors" ADD CONSTRAINT "snoozed_monitors_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "web_vitals_snapshots" ADD CONSTRAINT "web_vitals_snapshots_monitor_id_monitors_id_fk" FOREIGN KEY ("monitor_id") REFERENCES "public"."monitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dns_snapshots_monitor_created_idx" ON "dns_snapshots" USING btree ("monitor_id","created_at" desc);--> statement-breakpoint
CREATE UNIQUE INDEX "snoozed_monitors_monitor_idx" ON "snoozed_monitors" USING btree ("monitor_id");--> statement-breakpoint
CREATE INDEX "web_vitals_monitor_ts_idx" ON "web_vitals_snapshots" USING btree ("monitor_id","ts" desc);