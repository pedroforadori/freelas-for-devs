CREATE TABLE "levels" (
	"slug" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"rank" integer NOT NULL,
	CONSTRAINT "levels_rank_unique" UNIQUE("rank")
);
--> statement-breakpoint
CREATE TABLE "stacks" (
	"slug" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"company_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "freelancer_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"headline" text DEFAULT '' NOT NULL,
	"bio" text DEFAULT '' NOT NULL,
	"project_types" text[] DEFAULT '{}' NOT NULL,
	"links" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"available" boolean DEFAULT true NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"level_slug" text,
	"review_note" text,
	"submitted_at" timestamp with time zone,
	"reviewed_at" timestamp with time zone,
	"reviewed_by" uuid,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "freelancer_stacks" (
	"user_id" uuid NOT NULL,
	"stack_slug" text NOT NULL,
	CONSTRAINT "freelancer_stacks_user_id_stack_slug_pk" PRIMARY KEY("user_id","stack_slug")
);
--> statement-breakpoint
CREATE TABLE "level_changes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"from_level" text,
	"to_level" text NOT NULL,
	"reason" text NOT NULL,
	"changed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portfolio_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"url" text,
	"stacks" text[] DEFAULT '{}' NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "client_profiles" ADD CONSTRAINT "client_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "freelancer_profiles" ADD CONSTRAINT "freelancer_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "freelancer_profiles" ADD CONSTRAINT "freelancer_profiles_level_slug_levels_slug_fk" FOREIGN KEY ("level_slug") REFERENCES "public"."levels"("slug") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "freelancer_profiles" ADD CONSTRAINT "freelancer_profiles_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "freelancer_stacks" ADD CONSTRAINT "freelancer_stacks_user_id_freelancer_profiles_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."freelancer_profiles"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "freelancer_stacks" ADD CONSTRAINT "freelancer_stacks_stack_slug_stacks_slug_fk" FOREIGN KEY ("stack_slug") REFERENCES "public"."stacks"("slug") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "level_changes" ADD CONSTRAINT "level_changes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "level_changes" ADD CONSTRAINT "level_changes_from_level_levels_slug_fk" FOREIGN KEY ("from_level") REFERENCES "public"."levels"("slug") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "level_changes" ADD CONSTRAINT "level_changes_to_level_levels_slug_fk" FOREIGN KEY ("to_level") REFERENCES "public"."levels"("slug") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "level_changes" ADD CONSTRAINT "level_changes_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_items" ADD CONSTRAINT "portfolio_items_user_id_freelancer_profiles_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."freelancer_profiles"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "freelancer_profiles_review_queue_idx" ON "freelancer_profiles" USING btree ("status","submitted_at","user_id");--> statement-breakpoint
CREATE INDEX "freelancer_stacks_stack_idx" ON "freelancer_stacks" USING btree ("stack_slug");--> statement-breakpoint
CREATE INDEX "level_changes_user_idx" ON "level_changes" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "portfolio_items_user_idx" ON "portfolio_items" USING btree ("user_id","position");