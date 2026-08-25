CREATE TYPE "public"."delegation_state" AS ENUM('requested', 'dispatched', 'running', 'awaiting_input', 'completed', 'failed', 'cancelled', 'manual_intervention');--> statement-breakpoint
CREATE TABLE "delegations" (
	"delegation_id" varchar(30) PRIMARY KEY NOT NULL,
	"delegation_group_id" varchar(30),
	"parent_execution_id" varchar(30) NOT NULL,
	"child_execution_id" varchar(30) NOT NULL,
	"state" "delegation_state" NOT NULL,
	"revision" bigint NOT NULL,
	"input_digest" varchar(71) NOT NULL,
	"record" jsonb NOT NULL,
	"accepted_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "delegations_child_execution_unique" ON "delegations" USING btree ("child_execution_id");--> statement-breakpoint
CREATE INDEX "delegations_parent_state_index" ON "delegations" USING btree ("parent_execution_id","state");--> statement-breakpoint
CREATE INDEX "delegations_group_index" ON "delegations" USING btree ("delegation_group_id");