ALTER TABLE "execution_events" ADD COLUMN "workspace_id" varchar(30);--> statement-breakpoint
ALTER TABLE "execution_events" ADD COLUMN "project_id" varchar(30);--> statement-breakpoint
ALTER TABLE "execution_events" ADD COLUMN "task_id" varchar(30);--> statement-breakpoint
ALTER TABLE "execution_events" ADD COLUMN "agent_id" varchar(30);--> statement-breakpoint
UPDATE "execution_events" AS "event"
SET
	"workspace_id" = "execution"."workspace_id",
	"project_id" = "execution"."project_id",
	"task_id" = "execution"."task_id",
	"agent_id" = "execution"."agent_id"
FROM "executions" AS "execution"
WHERE "event"."execution_id" = "execution"."execution_id";--> statement-breakpoint
ALTER TABLE "execution_events" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "execution_events" ALTER COLUMN "project_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "execution_events" ALTER COLUMN "task_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "execution_events" ALTER COLUMN "agent_id" SET NOT NULL;
