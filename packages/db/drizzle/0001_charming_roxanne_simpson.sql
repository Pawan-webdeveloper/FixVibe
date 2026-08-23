ALTER TABLE "scans" ADD COLUMN "target_host" text NOT NULL;--> statement-breakpoint
CREATE INDEX "scans_anon_ip_created_idx" ON "scans" USING btree ("anon_ip_hash","created_at" desc);--> statement-breakpoint
CREATE INDEX "scans_target_host_created_idx" ON "scans" USING btree ("target_host","created_at" desc);