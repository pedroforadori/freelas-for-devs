CREATE TABLE "file_access_grants" (
	"file_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "file_access_grants_file_id_user_id_pk" PRIMARY KEY("file_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "contract_ratings" (
	"contract_id" uuid PRIMARY KEY NOT NULL,
	"freelancer_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"rating" integer NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deliveries" (
	"contract_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"submitted_at" timestamp with time zone NOT NULL,
	"message" text NOT NULL,
	"links" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"attachment_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"review_deadline_at" timestamp with time zone NOT NULL,
	"reviewed_at" timestamp with time zone,
	"outcome" text,
	"adjustments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"correction" jsonb,
	CONSTRAINT "deliveries_contract_id_number_submitted_at_pk" PRIMARY KEY("contract_id","number","submitted_at")
);
--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "stage" text;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "delivery_params" jsonb;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "corrections_used" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "approval_kind" text;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "released_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "transfer_ref" text;--> statement-breakpoint
ALTER TABLE "file_access_grants" ADD CONSTRAINT "file_access_grants_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_access_grants" ADD CONSTRAINT "file_access_grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_ratings" ADD CONSTRAINT "contract_ratings_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_ratings" ADD CONSTRAINT "contract_ratings_freelancer_id_users_id_fk" FOREIGN KEY ("freelancer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_ratings" ADD CONSTRAINT "contract_ratings_client_id_users_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deliveries_review_deadline_idx" ON "deliveries" USING btree ("reviewed_at","review_deadline_at");--> statement-breakpoint
CREATE INDEX "contracts_client_idx" ON "contracts" USING btree ("client_id","updated_at");--> statement-breakpoint
CREATE INDEX "contracts_freelancer_idx" ON "contracts" USING btree ("freelancer_id","updated_at");--> statement-breakpoint
-- Contratos pagos na F6 passam a ACTIVE (1ª entrega), com os prazos padrão.
UPDATE "contracts" SET "status" = 'ACTIVE', "stage" = 'WORKING_D1', "due_at" = "funded_at" + make_interval(days => "deadline_days"), "delivery_params" = '{"reviewDays":5,"autoApproveDays":7,"maxCorrections":1}'::jsonb WHERE "status" = 'FUNDED';
