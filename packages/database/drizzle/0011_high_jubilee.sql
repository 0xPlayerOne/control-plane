CREATE TYPE "public"."external_session_state" AS ENUM('active', 'closed', 'removed', 'revoked');--> statement-breakpoint
CREATE TABLE "external_sessions" (
	"external_session_id" varchar(30) PRIMARY KEY NOT NULL,
	"runtime_connection_id" varchar(30) NOT NULL,
	"opaque_native_session_id" varchar(31) NOT NULL,
	"workspace_id" varchar(30) NOT NULL,
	"project_id" varchar(30),
	"state" "external_session_state" NOT NULL,
	"ownership" jsonb NOT NULL,
	"capability_snapshot" jsonb NOT NULL,
	"safe_metadata" jsonb NOT NULL,
	"last_observed_at" timestamp with time zone NOT NULL,
	"version" bigint NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "external_sessions" ADD CONSTRAINT "external_sessions_runtime_connection_id_runtime_connections_runtime_connection_id_fk" FOREIGN KEY ("runtime_connection_id") REFERENCES "public"."runtime_connections"("runtime_connection_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "external_sessions_runtime_native_unique" ON "external_sessions" USING btree ("runtime_connection_id","opaque_native_session_id");--> statement-breakpoint
CREATE INDEX "external_sessions_scope_state_index" ON "external_sessions" USING btree ("workspace_id","project_id","state");--> statement-breakpoint
CREATE INDEX "external_sessions_runtime_index" ON "external_sessions" USING btree ("runtime_connection_id");