CREATE TYPE "public"."marketplace_installation_state" AS ENUM('pending-authorization', 'unavailable', 'rejected-by-policy', 'installed', 'superseded');--> statement-breakpoint
CREATE TABLE "marketplace_installations" (
	"installation_id" varchar(64) PRIMARY KEY NOT NULL,
	"catalog_id" varchar(71) NOT NULL,
	"workspace_id" varchar(256) NOT NULL,
	"user_id" varchar(256) NOT NULL,
	"plugin_id" varchar(192) NOT NULL,
	"release_id" varchar(71) NOT NULL,
	"canonical_content_digest" varchar(71) NOT NULL,
	"requested_harness" varchar(64) NOT NULL,
	"required_connectors" jsonb NOT NULL,
	"required_credentials" jsonb NOT NULL,
	"state" "public"."marketplace_installation_state" NOT NULL,
	"idempotency_key" varchar(128) NOT NULL,
	"request_digest" varchar(64) NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX "marketplace_installations_workspace_idempotency_unique" ON "marketplace_installations" USING btree ("workspace_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "marketplace_installations_workspace_index" ON "marketplace_installations" USING btree ("workspace_id","updated_at");
