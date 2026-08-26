ALTER TABLE "projects" ADD COLUMN "verification_token" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "verified_at" timestamp with time zone;