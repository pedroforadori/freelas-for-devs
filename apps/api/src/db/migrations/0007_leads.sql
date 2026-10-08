CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY NOT NULL,
	"profile" text NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"main_stack" text,
	"consent_version" text NOT NULL,
	"consented_at" timestamp with time zone NOT NULL,
	"utm" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "leads_email_profile_key" ON "leads" USING btree ("email","profile");