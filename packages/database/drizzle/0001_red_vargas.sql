CREATE TYPE "public"."execution_attempt_state" AS ENUM('queued', 'starting', 'running', 'awaiting_input', 'cancelling', 'completed', 'failed', 'cancelled', 'timed_out', 'reconciliation_required');--> statement-breakpoint
CREATE TYPE "public"."execution_failure_classification" AS ENUM('validation', 'policy', 'runtime_unavailable', 'runtime_error', 'infrastructure', 'timeout', 'cancelled', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."execution_state" AS ENUM('accepted', 'queued', 'starting', 'running', 'awaiting_input', 'cancelling', 'completed', 'failed', 'cancelled', 'timed_out', 'reconciliation_required');--> statement-breakpoint
CREATE TABLE "execution_attempts" (
	"attempt_id" varchar(30) PRIMARY KEY NOT NULL,
	"execution_id" varchar(30) NOT NULL,
	"sequence" integer NOT NULL,
	"state" "execution_attempt_state" NOT NULL,
	"version" bigint NOT NULL,
	"runtime_definition_id" varchar(30),
	"runtime_node_ref_id" varchar(30),
	"runtime_connection_id" varchar(30),
	"external_session_id" varchar(30),
	"failure_classification" "execution_failure_classification",
	"failure_code" varchar(128),
	"terminal_result_ref" varchar(30),
	"accepted_at" timestamp with time zone NOT NULL,
	"queued_at" timestamp with time zone,
	"starting_at" timestamp with time zone,
	"running_at" timestamp with time zone,
	"awaiting_input_at" timestamp with time zone,
	"cancelling_at" timestamp with time zone,
	"reconciliation_required_at" timestamp with time zone,
	"terminal_at" timestamp with time zone,
	"deadline_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "executions" (
	"execution_id" varchar(30) PRIMARY KEY NOT NULL,
	"state" "execution_state" NOT NULL,
	"version" bigint NOT NULL,
	"workspace_id" varchar(30) NOT NULL,
	"project_id" varchar(30) NOT NULL,
	"task_id" varchar(30) NOT NULL,
	"agent_id" varchar(30) NOT NULL,
	"request_id" varchar(30) NOT NULL,
	"execution_plan_id" varchar(30) NOT NULL,
	"execution_plan_digest" varchar(71) NOT NULL,
	"execution_plan_schema_version" integer NOT NULL,
	"parent_execution_id" varchar(30),
	"attempt_count" integer NOT NULL,
	"latest_attempt_id" varchar(30),
	"failure_classification" "execution_failure_classification",
	"failure_code" varchar(128),
	"terminal_result_ref" varchar(30),
	"accepted_at" timestamp with time zone NOT NULL,
	"queued_at" timestamp with time zone,
	"starting_at" timestamp with time zone,
	"running_at" timestamp with time zone,
	"awaiting_input_at" timestamp with time zone,
	"cancelling_at" timestamp with time zone,
	"reconciliation_required_at" timestamp with time zone,
	"terminal_at" timestamp with time zone,
	"deadline_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "execution_attempts" ADD CONSTRAINT "execution_attempts_execution_id_executions_execution_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."executions"("execution_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executions" ADD CONSTRAINT "executions_parent_execution_fk" FOREIGN KEY ("parent_execution_id") REFERENCES "public"."executions"("execution_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "execution_attempts_execution_sequence_unique" ON "execution_attempts" USING btree ("execution_id","sequence");--> statement-breakpoint
CREATE INDEX "execution_attempts_state_deadline_index" ON "execution_attempts" USING btree ("state","deadline_at");--> statement-breakpoint
CREATE INDEX "execution_attempts_runtime_index" ON "execution_attempts" USING btree ("runtime_definition_id","runtime_node_ref_id","runtime_connection_id");--> statement-breakpoint
CREATE INDEX "executions_scope_index" ON "executions" USING btree ("workspace_id","project_id","task_id");--> statement-breakpoint
CREATE INDEX "executions_state_deadline_index" ON "executions" USING btree ("state","deadline_at");--> statement-breakpoint
CREATE INDEX "executions_parent_index" ON "executions" USING btree ("parent_execution_id");--> statement-breakpoint
CREATE INDEX "executions_plan_index" ON "executions" USING btree ("execution_plan_id");