CREATE TYPE "public"."runtime_discovery_resource_kind" AS ENUM('runtime_connection', 'external_session');--> statement-breakpoint
CREATE TABLE "runtime_discovery_projections" (
	"kind" "runtime_discovery_resource_kind" NOT NULL,
	"resource_id" varchar(30) NOT NULL,
	"workspace_id" varchar(30) NOT NULL,
	"project_id" varchar(30),
	"runtime_node_ref_id" varchar(30),
	"model" jsonb NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "runtime_discovery_projections_kind_resource_id_pk" PRIMARY KEY("kind","resource_id")
);
--> statement-breakpoint
CREATE INDEX "runtime_discovery_workspace_kind_index" ON "runtime_discovery_projections" USING btree ("workspace_id","kind","resource_id");--> statement-breakpoint
CREATE INDEX "runtime_discovery_scope_index" ON "runtime_discovery_projections" USING btree ("workspace_id","project_id","runtime_node_ref_id");