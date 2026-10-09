CREATE TABLE "scope_versions" (
	"project_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"scope" jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scope_versions_project_id_version_pk" PRIMARY KEY("project_id","version")
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"version" integer NOT NULL,
	"updated_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "scope" jsonb;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "scope_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "scoping_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "scope_approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "scope_approved_by" uuid;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "rejection_reason" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "rejected_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "scope_versions" ADD CONSTRAINT "scope_versions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scope_versions" ADD CONSTRAINT "scope_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_scope_approved_by_users_id_fk" FOREIGN KEY ("scope_approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Projetos que já estavam em escopo antes desta migração entram nas métricas a partir da última alteração.
UPDATE "projects" SET "scoping_started_at" = "updated_at" WHERE "status" = 'SCOPING' AND "scoping_started_at" IS NULL;
