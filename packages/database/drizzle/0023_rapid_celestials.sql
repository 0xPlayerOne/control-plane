CREATE TABLE "execution_plans" (
	"execution_plan_id" varchar(30) PRIMARY KEY NOT NULL,
	"content_digest" varchar(71) NOT NULL,
	"schema_version" integer NOT NULL,
	"workspace_id" varchar(30) NOT NULL,
	"project_id" varchar(30) NOT NULL,
	"task_id" varchar(30) NOT NULL,
	"agent_id" varchar(30) NOT NULL,
	"plan" jsonb NOT NULL,
	"compiled_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "execution_plans_scope_index" ON "execution_plans" USING btree ("workspace_id","project_id","task_id","agent_id");