CREATE TYPE "public"."runtime_compatibility_state" AS ENUM('compatible', 'degraded', 'untested', 'incompatible', 'deprecated', 'revoked', 'unavailable', 'capability_missing');--> statement-breakpoint
CREATE TYPE "public"."runtime_connection_health" AS ENUM('healthy', 'degraded', 'unavailable');--> statement-breakpoint
CREATE TYPE "public"."runtime_connection_location" AS ENUM('local_device', 'managed_sandbox');--> statement-breakpoint
CREATE TYPE "public"."runtime_connection_status" AS ENUM('connected', 'degraded', 'unavailable', 'disconnected', 'expired', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."runtime_connection_type" AS ENUM('managed_cloud', 'managed_local', 'external_local');--> statement-breakpoint
CREATE TABLE "runtime_connections" (
	"runtime_connection_id" varchar(30) PRIMARY KEY NOT NULL,
	"identity_digest" varchar(71) NOT NULL,
	"connection_type" "runtime_connection_type" NOT NULL,
	"runtime_node_ref_id" varchar(30),
	"runtime_definition_id" varchar(30) NOT NULL,
	"location" "runtime_connection_location" NOT NULL,
	"opaque_native_ref" varchar(31),
	"adapter_version" varchar(32) NOT NULL,
	"driver_version" varchar(32) NOT NULL,
	"harness_version" varchar(32) NOT NULL,
	"status" "runtime_connection_status" NOT NULL,
	"health" "runtime_connection_health" NOT NULL,
	"capabilities" jsonb NOT NULL,
	"compatibility_state" "runtime_compatibility_state" NOT NULL,
	"limitations" jsonb NOT NULL,
	"last_discovered_at" timestamp with time zone NOT NULL,
	"last_heartbeat_at" timestamp with time zone NOT NULL,
	"last_health_check_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone,
	"version" bigint NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "runtime_connections_location_check" CHECK (("runtime_connections"."connection_type" = 'managed_cloud' and "runtime_connections"."location" = 'managed_sandbox' and "runtime_connections"."runtime_node_ref_id" is null) or ("runtime_connections"."connection_type" <> 'managed_cloud' and "runtime_connections"."location" = 'local_device' and "runtime_connections"."runtime_node_ref_id" is not null)),
	CONSTRAINT "runtime_connections_native_ref_check" CHECK ("runtime_connections"."opaque_native_ref" is null or "runtime_connections"."opaque_native_ref" ~ '^nref_[0-9A-HJKMNP-TV-Z]{26}$')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_connections_identity_unique" ON "runtime_connections" USING btree ("identity_digest");--> statement-breakpoint
CREATE INDEX "runtime_connections_node_index" ON "runtime_connections" USING btree ("runtime_node_ref_id");--> statement-breakpoint
CREATE INDEX "runtime_connections_status_freshness_index" ON "runtime_connections" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "runtime_connections_definition_index" ON "runtime_connections" USING btree ("runtime_definition_id");