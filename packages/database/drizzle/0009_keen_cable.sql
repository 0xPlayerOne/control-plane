CREATE TYPE "public"."runtime_availability_state" AS ENUM('healthy', 'degraded', 'reconnecting', 'offline', 'incompatible', 'revoked', 'stale', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."runtime_capability_verification" AS ENUM('verified', 'unverified');--> statement-breakpoint
ALTER TABLE "runtime_connections" ADD COLUMN "availability_state" "runtime_availability_state";--> statement-breakpoint
ALTER TABLE "runtime_connections" ADD COLUMN "protocol_version" varchar(32);--> statement-breakpoint
ALTER TABLE "runtime_connections" ADD COLUMN "capability_snapshot_version" bigint;--> statement-breakpoint
ALTER TABLE "runtime_connections" ADD COLUMN "capability_snapshot_observed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "runtime_connections" ADD COLUMN "capability_snapshot_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "runtime_connections" ADD COLUMN "capability_verification" "runtime_capability_verification";--> statement-breakpoint
ALTER TABLE "runtime_connections" ADD COLUMN "last_health_report_sequence" bigint;--> statement-breakpoint
ALTER TABLE "runtime_connections" ADD COLUMN "last_health_report_digest" varchar(71);--> statement-breakpoint
ALTER TABLE "runtime_connections" ADD COLUMN "diagnostics" jsonb;--> statement-breakpoint
CREATE INDEX "runtime_connections_availability_freshness_index" ON "runtime_connections" USING btree ("availability_state","capability_snapshot_expires_at");