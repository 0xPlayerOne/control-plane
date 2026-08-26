CREATE TYPE "public"."release_audit_action" AS ENUM('promote', 'rollback');--> statement-breakpoint
CREATE TABLE "release_audit_records" (
	"sequence" bigserial NOT NULL,
	"release_audit_id" varchar(36) PRIMARY KEY NOT NULL,
	"release_gate_id" varchar(256) NOT NULL,
	"action" "release_audit_action" NOT NULL,
	"evidence" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "release_audit_records_sequence_unique" UNIQUE("sequence")
);
--> statement-breakpoint
CREATE INDEX "release_audit_records_gate_sequence_index" ON "release_audit_records" USING btree ("release_gate_id","sequence");