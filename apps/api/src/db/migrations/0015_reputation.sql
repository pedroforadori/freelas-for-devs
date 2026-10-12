CREATE TABLE "freelancer_stats" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"completed_contracts" integer DEFAULT 0 NOT NULL,
	"started_contracts" integer DEFAULT 0 NOT NULL,
	"rating_count" integer DEFAULT 0 NOT NULL,
	"rating_sum" integer DEFAULT 0 NOT NULL,
	"on_time_contracts" integer DEFAULT 0 NOT NULL,
	"abandonments" integer DEFAULT 0 NOT NULL,
	"invitations_answered" integer DEFAULT 0 NOT NULL,
	"invitations_expired" integer DEFAULT 0 NOT NULL,
	"score" real DEFAULT 0.5 NOT NULL,
	"components" jsonb NOT NULL,
	"computed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "levels" ADD COLUMN "promotion" jsonb;--> statement-breakpoint
ALTER TABLE "queue_entries" ADD COLUMN "score" real DEFAULT 0.5 NOT NULL;--> statement-breakpoint
ALTER TABLE "freelancer_stats" ADD CONSTRAINT "freelancer_stats_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Regras iniciais de progressão (editáveis no painel). O nível mais alto não tem regra.
UPDATE "levels" SET "promotion" = '{"minCompleted":3,"minRatingAvg":4,"minOnTimeRate":0.7,"minScore":0.55,"maxAbandonments":0,"automatic":true}'::jsonb WHERE "slug" = 'iniciante' AND "promotion" IS NULL;
--> statement-breakpoint
UPDATE "levels" SET "promotion" = '{"minCompleted":8,"minRatingAvg":4.3,"minOnTimeRate":0.8,"minScore":0.6,"maxAbandonments":0,"automatic":true}'::jsonb WHERE "slug" = 'intermediario' AND "promotion" IS NULL;
--> statement-breakpoint
UPDATE "levels" SET "promotion" = '{"minCompleted":15,"minRatingAvg":4.6,"minOnTimeRate":0.85,"minScore":0.7,"maxAbandonments":0,"automatic":false}'::jsonb WHERE "slug" = 'avancado' AND "promotion" IS NULL;
