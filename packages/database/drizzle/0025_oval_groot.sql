CREATE TABLE "context_packages" (
	"context_package_id" varchar(30) PRIMARY KEY NOT NULL,
	"content_digest" varchar(71) NOT NULL,
	"schema_version" integer NOT NULL,
	"workspace_id" varchar(30) NOT NULL,
	"project_id" varchar(30) NOT NULL,
	"context_package" jsonb NOT NULL,
	"compiled_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "context_packages_content_digest_unique" ON "context_packages" USING btree ("content_digest");--> statement-breakpoint
CREATE INDEX "context_packages_scope_index" ON "context_packages" USING btree ("workspace_id","project_id","compiled_at");