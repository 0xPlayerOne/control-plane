CREATE TYPE "public"."runtime_event_message_kind" AS ENUM('progress', 'terminal');--> statement-breakpoint
CREATE TYPE "public"."runtime_event_receipt_outcome" AS ENUM('applied', 'out_of_order', 'terminal_conflict');--> statement-breakpoint
CREATE TABLE "runtime_event_receipts" (
	"command_id" varchar(30) NOT NULL,
	"message_kind" "runtime_event_message_kind" NOT NULL,
	"message_sequence" integer NOT NULL,
	"frame_hash" varchar(71) NOT NULL,
	"outcome" "runtime_event_receipt_outcome" NOT NULL,
	"event_id" varchar(30),
	"recorded_at" timestamp with time zone NOT NULL,
	CONSTRAINT "runtime_event_receipts_command_id_message_kind_message_sequence_pk" PRIMARY KEY("command_id","message_kind","message_sequence")
);
--> statement-breakpoint
ALTER TABLE "runtime_event_receipts" ADD CONSTRAINT "runtime_event_receipts_command_id_runtime_commands_command_id_fk" FOREIGN KEY ("command_id") REFERENCES "public"."runtime_commands"("command_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_event_receipts" ADD CONSTRAINT "runtime_event_receipts_event_id_execution_events_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."execution_events"("event_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "runtime_event_receipts_progress_order_index" ON "runtime_event_receipts" USING btree ("command_id","message_kind","message_sequence");--> statement-breakpoint
CREATE INDEX "runtime_event_receipts_event_index" ON "runtime_event_receipts" USING btree ("event_id");