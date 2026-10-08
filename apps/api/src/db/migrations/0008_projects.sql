CREATE TABLE "ai_estimation_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"round" integer NOT NULL,
	"outcome" text NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"duration_ms" integer NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_attachments" (
	"project_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "project_attachments_project_id_file_id_pk" PRIMARY KEY("project_id","file_id")
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY NOT NULL,
	"client_id" uuid NOT NULL,
	"title" text NOT NULL,
	"type" text NOT NULL,
	"description" text NOT NULL,
	"references" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"desired_deadline" text,
	"status" text NOT NULL,
	"estimation_round" integer DEFAULT 1 NOT NULL,
	"clarification" jsonb,
	"estimate" jsonb,
	"estimate_failed" boolean DEFAULT false NOT NULL,
	"cancel_reason" text,
	"cancelled_at" timestamp with time zone,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_estimation_runs" ADD CONSTRAINT "ai_estimation_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_attachments" ADD CONSTRAINT "project_attachments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_attachments" ADD CONSTRAINT "project_attachments_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_client_id_users_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_estimation_runs_project_idx" ON "ai_estimation_runs" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "projects_client_idx" ON "projects" USING btree ("client_id","created_at","id");--> statement-breakpoint
CREATE INDEX "projects_status_idx" ON "projects" USING btree ("status","created_at","id");