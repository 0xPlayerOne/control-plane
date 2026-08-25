CREATE TYPE "public"."usage_funding_source" AS ENUM('hq_managed', 'external_subscription');--> statement-breakpoint
CREATE TYPE "public"."usage_ledger_entry_kind" AS ENUM('reservation', 'model_usage', 'tool_charge', 'sandbox_usage', 'adjustment', 'release', 'settlement', 'refund', 'credit');--> statement-breakpoint
CREATE TABLE "usage_ledger_entries" (
	"entry_id" varchar(30) PRIMARY KEY NOT NULL,
	"sequence" integer NOT NULL,
	"workspace_id" varchar(30) NOT NULL,
	"execution_id" varchar(30) NOT NULL,
	"attempt_id" varchar(30),
	"parent_execution_id" varchar(30),
	"kind" "usage_ledger_entry_kind" NOT NULL,
	"source_id" varchar(256) NOT NULL,
	"idempotency_key" varchar(256) NOT NULL,
	"reservation_key" varchar(256),
	"funding_source" "usage_funding_source" NOT NULL,
	"quantity" jsonb NOT NULL,
	"currency" varchar(3) NOT NULL,
	"cost_microunits" bigint NOT NULL,
	"cost_exact" boolean NOT NULL,
	"authorization_decision_id" varchar(71),
	"recorded_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "usage_ledger_entries" ADD CONSTRAINT "usage_ledger_entries_execution_id_executions_execution_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."executions"("execution_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "usage_ledger_execution_sequence_unique" ON "usage_ledger_entries" USING btree ("execution_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "usage_ledger_workspace_idempotency_unique" ON "usage_ledger_entries" USING btree ("workspace_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "usage_ledger_execution_recorded_index" ON "usage_ledger_entries" USING btree ("execution_id","recorded_at");