CREATE TYPE "public"."repo_category" AS ENUM('secrets', 'supply-chain', 'ci-cd', 'code-quality', 'dependencies', 'governance');--> statement-breakpoint
CREATE TYPE "public"."repo_finding_status" AS ENUM('open', 'fixed', 'ignored');--> statement-breakpoint
CREATE TYPE "public"."repo_scan_profile" AS ENUM('shallow', 'deep');--> statement-breakpoint
CREATE TYPE "public"."repo_scan_status" AS ENUM('queued', 'running', 'done', 'failed');--> statement-breakpoint
CREATE TABLE "github_installations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"installation_id" bigint NOT NULL,
	"account_login" text NOT NULL,
	"account_type" text NOT NULL,
	"installed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "github_installations_installation_id_unique" UNIQUE("installation_id")
);
--> statement-breakpoint
CREATE TABLE "github_repos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"installation_id" uuid NOT NULL,
	"owner" text NOT NULL,
	"name" text NOT NULL,
	"full_name" text NOT NULL,
	"default_branch" text DEFAULT 'main' NOT NULL,
	"private" boolean DEFAULT false NOT NULL,
	"github_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "repo_findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repo_scan_id" uuid NOT NULL,
	"check_id" text NOT NULL,
	"category" "repo_category" NOT NULL,
	"severity" "severity" NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"evidence" jsonb,
	"remediation" text NOT NULL,
	"fix_prompt" text NOT NULL,
	"status" "repo_finding_status" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "repo_scans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repo_id" uuid NOT NULL,
	"requested_by" uuid,
	"profile" "repo_scan_profile" DEFAULT 'shallow' NOT NULL,
	"status" "repo_scan_status" DEFAULT 'queued' NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"duration_ms" integer,
	"scores" jsonb,
	"context_meta" jsonb,
	"engine_version" text NOT NULL,
	"checks_run" integer NOT NULL,
	"check_errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "github_installations" ADD CONSTRAINT "github_installations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_repos" ADD CONSTRAINT "github_repos_installation_id_github_installations_id_fk" FOREIGN KEY ("installation_id") REFERENCES "public"."github_installations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repo_findings" ADD CONSTRAINT "repo_findings_repo_scan_id_repo_scans_id_fk" FOREIGN KEY ("repo_scan_id") REFERENCES "public"."repo_scans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repo_scans" ADD CONSTRAINT "repo_scans_repo_id_github_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."github_repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repo_scans" ADD CONSTRAINT "repo_scans_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "github_installations_user_installation_idx" ON "github_installations" USING btree ("user_id","installation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "github_repos_installation_owner_name_idx" ON "github_repos" USING btree ("installation_id","owner","name");--> statement-breakpoint
CREATE INDEX "repo_findings_scan_severity_idx" ON "repo_findings" USING btree ("repo_scan_id","severity");--> statement-breakpoint
CREATE INDEX "repo_findings_scan_check_idx" ON "repo_findings" USING btree ("repo_scan_id","check_id");--> statement-breakpoint
CREATE INDEX "repo_scans_repo_created_idx" ON "repo_scans" USING btree ("repo_id","created_at" desc);--> statement-breakpoint
CREATE INDEX "repo_scans_status_idx" ON "repo_scans" USING btree ("status");