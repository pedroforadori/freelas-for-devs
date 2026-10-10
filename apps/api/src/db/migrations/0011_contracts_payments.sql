CREATE TABLE "contracts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"invitation_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"freelancer_id" uuid NOT NULL,
	"status" text NOT NULL,
	"proposal_cents" integer NOT NULL,
	"deadline_days" integer NOT NULL,
	"commission_bps" integer NOT NULL,
	"commission_payer" text NOT NULL,
	"platform_fee_cents" integer NOT NULL,
	"client_total_cents" integer NOT NULL,
	"freelancer_net_cents" integer NOT NULL,
	"payment_deadline_at" timestamp with time zone NOT NULL,
	"funded_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"journal_id" uuid NOT NULL,
	"contract_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"account" text NOT NULL,
	"debit_cents" integer DEFAULT 0 NOT NULL,
	"credit_cents" integer DEFAULT 0 NOT NULL,
	"reference" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"contract_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_checkout_id" text NOT NULL,
	"provider_payment_ref" text,
	"checkout_url" text NOT NULL,
	"checkout_expires_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"succeeded_at" timestamp with time zone,
	"refunded_at" timestamp with time zone,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payout_accounts" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"details_submitted" boolean DEFAULT false NOT NULL,
	"payouts_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"provider" text NOT NULL,
	"event_id" text NOT NULL,
	"type" text NOT NULL,
	"received_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_invitation_id_invitations_id_fk" FOREIGN KEY ("invitation_id") REFERENCES "public"."invitations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_client_id_users_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_freelancer_id_users_id_fk" FOREIGN KEY ("freelancer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_accounts" ADD CONSTRAINT "payout_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "contracts_invitation_key" ON "contracts" USING btree ("invitation_id");--> statement-breakpoint
CREATE INDEX "contracts_project_idx" ON "contracts" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "contracts_payment_deadline_idx" ON "contracts" USING btree ("status","payment_deadline_at");--> statement-breakpoint
CREATE INDEX "ledger_entries_contract_idx" ON "ledger_entries" USING btree ("contract_id","account");--> statement-breakpoint
CREATE INDEX "ledger_entries_journal_idx" ON "ledger_entries" USING btree ("journal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_provider_checkout_key" ON "payments" USING btree ("provider","provider_checkout_id");--> statement-breakpoint
CREATE INDEX "payments_contract_idx" ON "payments" USING btree ("contract_id");--> statement-breakpoint
CREATE INDEX "payments_pending_idx" ON "payments" USING btree ("status","created_at") WHERE "payments"."status" = 'PENDING';--> statement-breakpoint
CREATE UNIQUE INDEX "payout_accounts_provider_key" ON "payout_accounts" USING btree ("provider","provider_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_events_key" ON "webhook_events" USING btree ("provider","event_id");