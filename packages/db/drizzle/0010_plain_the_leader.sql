ALTER TYPE "public"."alert_channel" ADD VALUE 'webhook';--> statement-breakpoint
ALTER TYPE "public"."alert_channel" ADD VALUE 'discord';--> statement-breakpoint
CREATE TABLE "incident_updates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"incident_id" uuid NOT NULL,
	"status" text NOT NULL,
	"message" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "maintenance_windows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"monitor_id" uuid,
	"day_of_week" integer,
	"start_time" time NOT NULL,
	"duration_min" integer NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"reason" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "monitor_daily_rollups" (
	"monitor_id" uuid NOT NULL,
	"day" timestamp with time zone NOT NULL,
	"total_checks" integer NOT NULL,
	"up_checks" integer NOT NULL,
	"avg_latency_ms" integer,
	"p95_latency_ms" integer,
	CONSTRAINT "monitor_daily_rollups_monitor_id_day_pk" PRIMARY KEY("monitor_id","day")
);
--> statement-breakpoint
CREATE TABLE "monitor_hourly_rollups" (
	"monitor_id" uuid NOT NULL,
	"hour" timestamp with time zone NOT NULL,
	"total_checks" integer NOT NULL,
	"up_checks" integer NOT NULL,
	"avg_latency_ms" integer,
	"p95_latency_ms" integer,
	"min_latency_ms" integer,
	"max_latency_ms" integer,
	CONSTRAINT "monitor_hourly_rollups_monitor_id_hour_pk" PRIMARY KEY("monitor_id","hour")
);
--> statement-breakpoint
CREATE TABLE "psi_cache" (
	"url" text PRIMARY KEY NOT NULL,
	"result" jsonb NOT NULL,
	"cached_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "status_subscribers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"email" text NOT NULL,
	"token" text NOT NULL,
	"confirmed" boolean DEFAULT false NOT NULL,
	"confirmed_at" timestamp with time zone,
	"unsubscribed_at" timestamp with time zone,
	"ip_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "alerts" ADD COLUMN "dedup_key" text;--> statement-breakpoint
ALTER TABLE "incidents" ADD COLUMN "acknowledged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "incidents" ADD COLUMN "acknowledged_by" uuid;--> statement-breakpoint
ALTER TABLE "incidents" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "logo_url" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "brand_color" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "robots_indexable" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "web_vitals_snapshots" ADD COLUMN "inp_ms" integer;--> statement-breakpoint
ALTER TABLE "incident_updates" ADD CONSTRAINT "incident_updates_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_updates" ADD CONSTRAINT "incident_updates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_windows" ADD CONSTRAINT "maintenance_windows_monitor_id_monitors_id_fk" FOREIGN KEY ("monitor_id") REFERENCES "public"."monitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_windows" ADD CONSTRAINT "maintenance_windows_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitor_daily_rollups" ADD CONSTRAINT "monitor_daily_rollups_monitor_id_monitors_id_fk" FOREIGN KEY ("monitor_id") REFERENCES "public"."monitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitor_hourly_rollups" ADD CONSTRAINT "monitor_hourly_rollups_monitor_id_monitors_id_fk" FOREIGN KEY ("monitor_id") REFERENCES "public"."monitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_subscribers" ADD CONSTRAINT "status_subscribers_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "incident_updates_incident_created_idx" ON "incident_updates" USING btree ("incident_id","created_at");--> statement-breakpoint
CREATE INDEX "maintenance_windows_monitor_enabled_idx" ON "maintenance_windows" USING btree ("monitor_id","enabled");--> statement-breakpoint
CREATE UNIQUE INDEX "status_subscribers_project_email_idx" ON "status_subscribers" USING btree ("project_id","email");--> statement-breakpoint
CREATE UNIQUE INDEX "status_subscribers_token_idx" ON "status_subscribers" USING btree ("token");--> statement-breakpoint
CREATE INDEX "status_subscribers_project_active_idx" ON "status_subscribers" USING btree ("project_id") WHERE "status_subscribers"."confirmed" = true AND "status_subscribers"."unsubscribed_at" IS NULL;--> statement-breakpoint
CREATE INDEX "status_subscribers_ip_hash_created_idx" ON "status_subscribers" USING btree ("ip_hash","created_at") WHERE "status_subscribers"."ip_hash" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_acknowledged_by_users_id_fk" FOREIGN KEY ("acknowledged_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "alerts_dedup_key_unique_idx" ON "alerts" USING btree ("dedup_key") WHERE "alerts"."dedup_key" is not null;