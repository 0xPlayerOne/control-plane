CREATE TYPE "public"."runtime_command_status" AS ENUM('queued', 'dispatched', 'acknowledged', 'succeeded', 'failed', 'cancelled', 'expired');--> statement-breakpoint
CREATE TABLE "runtime_commands" (
	"command_id" varchar(30) PRIMARY KEY NOT NULL,
	"execution_id" varchar(30) NOT NULL,
	"attempt_id" varchar(30) NOT NULL,
	"runtime_node_ref_id" varchar(30) NOT NULL,
	"runtime_connection_id" varchar(30) NOT NULL,
	"workspace_id" varchar(30) NOT NULL,
	"idempotency_key" varchar(128) NOT NULL,
	"payload_hash" varchar(71) NOT NULL,
	"command_envelope" jsonb NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"status" "runtime_command_status" NOT NULL,
	"version" bigint NOT NULL,
	"delivery_attempts" bigint NOT NULL,
	"last_channel_generation" bigint,
	"last_sequence" bigint,
	"first_dispatched_at" timestamp with time zone,
	"last_dispatched_at" timestamp with time zone,
	"acknowledgement_reference" varchar(128),
	"acknowledgement_disposition" varchar(16),
	"acknowledged_at" timestamp with time zone,
	"result_reference" varchar(30),
	"result_status" varchar(16),
	"result_recorded_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "runtime_commands" ADD CONSTRAINT "runtime_commands_execution_id_executions_execution_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."executions"("execution_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_commands" ADD CONSTRAINT "runtime_commands_attempt_id_execution_attempts_attempt_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."execution_attempts"("attempt_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_commands" ADD CONSTRAINT "runtime_commands_runtime_connection_id_runtime_connections_runtime_connection_id_fk" FOREIGN KEY ("runtime_connection_id") REFERENCES "public"."runtime_connections"("runtime_connection_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "runtime_commands_node_status_issued_index" ON "runtime_commands" USING btree ("runtime_node_ref_id","status","issued_at");--> statement-breakpoint
CREATE INDEX "runtime_commands_expiry_index" ON "runtime_commands" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "runtime_commands_execution_attempt_index" ON "runtime_commands" USING btree ("execution_id","attempt_id");