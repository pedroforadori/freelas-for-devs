CREATE TABLE "distribution_rounds" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"status" text NOT NULL,
	"level_slug" text NOT NULL,
	"project_type" text NOT NULL,
	"required_stacks" text[] DEFAULT '{}' NOT NULL,
	"client_id" uuid NOT NULL,
	"params" jsonb NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	"version" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"round_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"freelancer_id" uuid NOT NULL,
	"status" text NOT NULL,
	"invited_at" timestamp with time zone NOT NULL,
	"deadline_at" timestamp with time zone NOT NULL,
	"responded_at" timestamp with time zone,
	"proposal_amount_cents" integer,
	"proposal_deadline_days" integer,
	"proposal_message" text,
	"proposal_submitted_at" timestamp with time zone,
	"proposal_updated_at" timestamp with time zone,
	"selection_feedback" jsonb,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "queue_entries" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"level_slug" text NOT NULL,
	"state" text DEFAULT 'ACTIVE' NOT NULL,
	"tier" text DEFAULT 'NORMAL' NOT NULL,
	"priority_since" timestamp with time zone,
	"last_invited_at" timestamp with time zone,
	"rounds_without_selection" integer DEFAULT 0 NOT NULL,
	"open_invitations" integer DEFAULT 0 NOT NULL,
	"declines" integer DEFAULT 0 NOT NULL,
	"no_responses" integer DEFAULT 0 NOT NULL,
	"selections" integer DEFAULT 0 NOT NULL,
	"monitoring_since" timestamp with time zone,
	"version" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "distribution_rounds" ADD CONSTRAINT "distribution_rounds_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "distribution_rounds" ADD CONSTRAINT "distribution_rounds_level_slug_levels_slug_fk" FOREIGN KEY ("level_slug") REFERENCES "public"."levels"("slug") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "distribution_rounds" ADD CONSTRAINT "distribution_rounds_client_id_users_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_round_id_distribution_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."distribution_rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_freelancer_id_users_id_fk" FOREIGN KEY ("freelancer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "queue_entries" ADD CONSTRAINT "queue_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "queue_entries" ADD CONSTRAINT "queue_entries_level_slug_levels_slug_fk" FOREIGN KEY ("level_slug") REFERENCES "public"."levels"("slug") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "distribution_rounds_active_key" ON "distribution_rounds" USING btree ("project_id") WHERE "distribution_rounds"."status" in ('OPEN', 'SELECTED');--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_project_freelancer_key" ON "invitations" USING btree ("project_id","freelancer_id");--> statement-breakpoint
CREATE INDEX "invitations_deadline_idx" ON "invitations" USING btree ("status","deadline_at");--> statement-breakpoint
CREATE INDEX "invitations_freelancer_idx" ON "invitations" USING btree ("freelancer_id","status","invited_at");--> statement-breakpoint
CREATE INDEX "invitations_round_idx" ON "invitations" USING btree ("round_id");--> statement-breakpoint
CREATE INDEX "queue_entries_order_idx" ON "queue_entries" USING btree ("level_slug","state","tier","priority_since","last_invited_at");--> statement-breakpoint
-- Freelancers já aprovados entram na fila do seu nível (sem histórico: vão à frente).
INSERT INTO "queue_entries" ("user_id", "level_slug")
SELECT "user_id", "level_slug" FROM "freelancer_profiles"
WHERE "status" = 'APPROVED' AND "level_slug" IS NOT NULL
ON CONFLICT ("user_id") DO NOTHING;
