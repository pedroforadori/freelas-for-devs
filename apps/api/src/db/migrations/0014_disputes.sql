CREATE TABLE "disputes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"contract_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"opened_by" text NOT NULL,
	"opener_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"description" text NOT NULL,
	"evidence_deadline_at" timestamp with time zone NOT NULL,
	"statements" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"resolution" jsonb,
	"execution" jsonb NOT NULL,
	"closed_at" timestamp with time zone,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "out_of_scope_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"contract_id" uuid NOT NULL,
	"status" text NOT NULL,
	"description" text NOT NULL,
	"proposal_cents" integer NOT NULL,
	"platform_fee_cents" integer NOT NULL,
	"client_total_cents" integer NOT NULL,
	"freelancer_net_cents" integer NOT NULL,
	"extra_days" integer NOT NULL,
	"contest_reason" text,
	"ruling" jsonb,
	"payment_deadline_at" timestamp with time zone,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "queue_entries" ADD COLUMN "abandonments" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "holds" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "paused_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "refunded_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "out_of_scope_id" uuid;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_opener_id_users_id_fk" FOREIGN KEY ("opener_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "out_of_scope_requests" ADD CONSTRAINT "out_of_scope_requests_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "disputes_contract_idx" ON "disputes" USING btree ("contract_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "disputes_active_contract_key" ON "disputes" USING btree ("contract_id") WHERE "disputes"."status" in ('OPEN', 'UNDER_REVIEW', 'EXECUTING');--> statement-breakpoint
CREATE INDEX "disputes_status_idx" ON "disputes" USING btree ("status","evidence_deadline_at");--> statement-breakpoint
CREATE INDEX "out_of_scope_contract_idx" ON "out_of_scope_requests" USING btree ("contract_id","created_at");--> statement-breakpoint
CREATE INDEX "out_of_scope_payment_deadline_idx" ON "out_of_scope_requests" USING btree ("status","payment_deadline_at");--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_out_of_scope_id_out_of_scope_requests_id_fk" FOREIGN KEY ("out_of_scope_id") REFERENCES "public"."out_of_scope_requests"("id") ON DELETE no action ON UPDATE no action;