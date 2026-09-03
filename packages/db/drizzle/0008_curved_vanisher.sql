CREATE TABLE "incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"monitor_id" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"duration_ms" integer,
	"status_code" integer,
	"detail" text
);
--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_monitor_id_monitors_id_fk" FOREIGN KEY ("monitor_id") REFERENCES "public"."monitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "incidents_monitor_started_idx" ON "incidents" USING btree ("monitor_id","started_at" desc);--> statement-breakpoint
CREATE INDEX "incidents_unresolved_idx" ON "incidents" USING btree ("monitor_id","resolved_at");