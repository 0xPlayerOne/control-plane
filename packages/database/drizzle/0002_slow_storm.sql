CREATE TYPE "public"."command_inbox_status" AS ENUM('accepted', 'processing', 'completed', 'failed', 'reconciliation_required');--> statement-breakpoint
CREATE TABLE "command_inbox" (
	"command_id" varchar(30) PRIMARY KEY NOT NULL,
	"caller_principal_id" varchar(64) NOT NULL,
	"operation" varchar(128) NOT NULL,
	"workspace_id" varchar(30) NOT NULL,
	"project_id" varchar(30) NOT NULL,
	"task_id" varchar(30) NOT NULL,
	"agent_id" varchar(30) NOT NULL,
	"request_id" varchar(30) NOT NULL,
	"idempotency_key" varchar(128) NOT NULL,
	"payload_hash" varchar(64) NOT NULL,
	"status" "command_inbox_status" NOT NULL,
	"execution_id" varchar(30) NOT NULL,
	"execution_plan_id" varchar(30) NOT NULL,
	"execution_plan_digest" varchar(71) NOT NULL,
	"execution_plan_schema_version" integer NOT NULL,
	"version" integer NOT NULL,
	"conflict_count" integer NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"retention_expires_at" timestamp with time zone NOT NULL,
	"last_conflict_at" timestamp with time zone,
	"processing_at" timestamp with time zone,
	"reconciliation_required_at" timestamp with time zone,
	"terminal_at" timestamp with time zone,
	"result_reference" varchar(30),
	"error_reference" varchar(512)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "command_inbox_scope_idempotency_unique" ON "command_inbox" USING btree ("caller_principal_id","operation","workspace_id","project_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "command_inbox_status_retention_index" ON "command_inbox" USING btree ("status","retention_expires_at");--> statement-breakpoint
CREATE INDEX "command_inbox_execution_index" ON "command_inbox" USING btree ("execution_id");--> statement-breakpoint
CREATE INDEX "command_inbox_request_index" ON "command_inbox" USING btree ("request_id");