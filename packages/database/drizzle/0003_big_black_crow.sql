CREATE TYPE "public"."event_publication_status" AS ENUM('pending', 'published', 'failed');--> statement-breakpoint
CREATE TABLE "execution_events" (
	"event_id" varchar(30) PRIMARY KEY NOT NULL,
	"execution_id" varchar(30) NOT NULL,
	"attempt_id" varchar(30),
	"workflow_id" varchar(30),
	"sequence" integer NOT NULL,
	"event_type" varchar(128) NOT NULL,
	"schema_version" integer NOT NULL,
	"request_id" varchar(30) NOT NULL,
	"command_id" varchar(30),
	"trace_id" varchar(30) NOT NULL,
	"payload" jsonb NOT NULL,
	"payload_bytes" integer NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"retention_expires_at" timestamp with time zone NOT NULL,
	"archived_at" timestamp with time zone,
	"publication_status" "event_publication_status" NOT NULL,
	"publication_attempts" integer NOT NULL,
	"publication_version" integer NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"publication_error_reference" varchar(512)
);
--> statement-breakpoint
ALTER TABLE "execution_events" ADD CONSTRAINT "execution_events_execution_id_executions_execution_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."executions"("execution_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "execution_events_execution_sequence_unique" ON "execution_events" USING btree ("execution_id","sequence");--> statement-breakpoint
CREATE INDEX "execution_events_replay_index" ON "execution_events" USING btree ("execution_id","sequence","archived_at");--> statement-breakpoint
CREATE INDEX "execution_events_publication_index" ON "execution_events" USING btree ("publication_status","recorded_at");--> statement-breakpoint
CREATE INDEX "execution_events_retention_index" ON "execution_events" USING btree ("retention_expires_at","archived_at");