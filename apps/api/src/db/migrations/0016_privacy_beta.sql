CREATE TABLE "beta_invites" (
	"email" text PRIMARY KEY NOT NULL,
	"invited_by" uuid,
	"invited_at" timestamp with time zone NOT NULL
);
