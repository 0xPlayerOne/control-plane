CREATE TYPE "public"."evaluation_run_status" AS ENUM('failed', 'passed');--> statement-breakpoint
CREATE TABLE "evaluation_runs" (
	"eval_run_id" varchar(256) PRIMARY KEY NOT NULL,
	"status" "evaluation_run_status" NOT NULL,
	"evidence" jsonb NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "evaluation_runs_status_completed_index" ON "evaluation_runs" USING btree ("status","completed_at");