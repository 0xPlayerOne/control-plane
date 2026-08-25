CREATE TYPE "public"."memory_write_proposal_state" AS ENUM('proposed', 'awaiting_approval', 'approved', 'denied', 'expired', 'revoked', 'committing', 'committed', 'failed', 'reconciliation_required');--> statement-breakpoint
CREATE TABLE "memory_write_proposals" (
	"proposal_id" varchar(30) PRIMARY KEY NOT NULL,
	"workspace_id" varchar(30) NOT NULL,
	"dedupe_hint" varchar(256) NOT NULL,
	"state" "memory_write_proposal_state" NOT NULL,
	"version" integer NOT NULL,
	"proposal" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "memory_write_proposals_workspace_dedupe_unique" ON "memory_write_proposals" USING btree ("workspace_id","dedupe_hint");--> statement-breakpoint
CREATE INDEX "memory_write_proposals_state_updated_index" ON "memory_write_proposals" USING btree ("state","updated_at");