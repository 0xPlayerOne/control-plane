CREATE TYPE "public"."interaction_kind" AS ENUM('approval', 'input', 'permission', 'resume', 'cancel');--> statement-breakpoint
CREATE TYPE "public"."interaction_state" AS ENUM('pending', 'responded', 'expired', 'cancelled');--> statement-breakpoint
CREATE TABLE "interaction_requests" (
	"interaction_id" varchar(30) PRIMARY KEY NOT NULL,
	"execution_id" varchar(30) NOT NULL,
	"attempt_id" varchar(30) NOT NULL,
	"kind" "interaction_kind" NOT NULL,
	"state" "interaction_state" NOT NULL,
	"prompt" jsonb NOT NULL,
	"allowed_actions" jsonb NOT NULL,
	"allowed_principal_ids" jsonb NOT NULL,
	"version" integer NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"response" jsonb,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "interaction_requests" ADD CONSTRAINT "interaction_requests_execution_id_executions_execution_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."executions"("execution_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interaction_requests" ADD CONSTRAINT "interaction_requests_attempt_id_execution_attempts_attempt_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."execution_attempts"("attempt_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "interaction_requests_execution_index" ON "interaction_requests" USING btree ("execution_id","requested_at");--> statement-breakpoint
CREATE INDEX "interaction_requests_attempt_state_index" ON "interaction_requests" USING btree ("attempt_id","state");--> statement-breakpoint
CREATE INDEX "interaction_requests_expiry_index" ON "interaction_requests" USING btree ("state","expires_at");