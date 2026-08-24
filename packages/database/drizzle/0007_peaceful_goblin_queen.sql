CREATE TYPE "public"."reconciliation_action" AS ENUM('none', 'resume_existing_workflow', 'wait_for_runtime', 'manual_intervention', 'apply_runtime_terminal', 'replay_events');--> statement-breakpoint
CREATE TYPE "public"."reconciliation_checkpoint_state" AS ENUM('reconciling', 'waiting', 'remediated', 'manual_intervention', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."reconciliation_reason" AS ENUM('accepted_unstarted', 'stale_heartbeat', 'runtime_disconnected', 'runtime_disappeared', 'workflow_stalled', 'runtime_terminal_unrecorded', 'terminal_undelivered', 'healthy');--> statement-breakpoint
CREATE TABLE "reconciliation_checkpoints" (
	"checkpoint_id" varchar(36) PRIMARY KEY NOT NULL,
	"execution_id" varchar(30) NOT NULL,
	"command_id" varchar(30) NOT NULL,
	"attempt_id" varchar(30),
	"workflow_id" varchar(30),
	"runtime_command_id" varchar(256),
	"pending_event_count" integer NOT NULL,
	"observation_hash" varchar(64) NOT NULL,
	"reason" "reconciliation_reason" NOT NULL,
	"action" "reconciliation_action" NOT NULL,
	"state" "reconciliation_checkpoint_state" NOT NULL,
	"diagnostics" jsonb NOT NULL,
	"version" integer NOT NULL,
	"checked_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "reconciliation_checkpoints" ADD CONSTRAINT "reconciliation_checkpoints_execution_id_executions_execution_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."executions"("execution_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_checkpoints" ADD CONSTRAINT "reconciliation_checkpoints_command_id_command_inbox_command_id_fk" FOREIGN KEY ("command_id") REFERENCES "public"."command_inbox"("command_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_checkpoints" ADD CONSTRAINT "reconciliation_checkpoints_attempt_id_execution_attempts_attempt_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."execution_attempts"("attempt_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reconciliation_checkpoints_observation_unique" ON "reconciliation_checkpoints" USING btree ("observation_hash");--> statement-breakpoint
CREATE INDEX "reconciliation_checkpoints_execution_index" ON "reconciliation_checkpoints" USING btree ("execution_id","checked_at");--> statement-breakpoint
CREATE INDEX "reconciliation_checkpoints_command_index" ON "reconciliation_checkpoints" USING btree ("command_id");--> statement-breakpoint
CREATE INDEX "reconciliation_checkpoints_state_index" ON "reconciliation_checkpoints" USING btree ("state","updated_at");