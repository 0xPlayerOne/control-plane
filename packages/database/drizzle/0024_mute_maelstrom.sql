CREATE TYPE "public"."state_promotion_proposal_state" AS ENUM('candidate', 'approved', 'rejected', 'merged', 'superseded', 'expired');--> statement-breakpoint
CREATE TABLE "project_state_mutations" (
	"workspace_id" varchar(30) NOT NULL,
	"project_id" varchar(30) NOT NULL,
	"mutation_id" varchar(30) NOT NULL,
	"input_digest" varchar(71) NOT NULL,
	"resulting_revision" integer NOT NULL,
	"touched_item_ids" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_state_mutations_workspace_id_project_id_mutation_id_pk" PRIMARY KEY("workspace_id","project_id","mutation_id")
);
--> statement-breakpoint
CREATE TABLE "project_state_revisions" (
	"workspace_id" varchar(30) NOT NULL,
	"project_id" varchar(30) NOT NULL,
	"revision" integer NOT NULL,
	"state" jsonb NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	CONSTRAINT "project_state_revisions_workspace_id_project_id_revision_pk" PRIMARY KEY("workspace_id","project_id","revision")
);
--> statement-breakpoint
CREATE TABLE "project_states" (
	"workspace_id" varchar(30) NOT NULL,
	"project_id" varchar(30) NOT NULL,
	"revision" integer NOT NULL,
	"state" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "project_states_workspace_id_project_id_pk" PRIMARY KEY("workspace_id","project_id")
);
--> statement-breakpoint
CREATE TABLE "state_promotion_proposals" (
	"proposal_id" varchar(30) PRIMARY KEY NOT NULL,
	"workspace_id" varchar(30) NOT NULL,
	"project_id" varchar(30) NOT NULL,
	"revision" integer NOT NULL,
	"state" "state_promotion_proposal_state" NOT NULL,
	"proposal" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_state_mutations" ADD CONSTRAINT "project_state_mutations_revision_fk" FOREIGN KEY ("workspace_id","project_id","resulting_revision") REFERENCES "public"."project_state_revisions"("workspace_id","project_id","revision") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_state_revisions" ADD CONSTRAINT "project_state_revisions_state_fk" FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."project_states"("workspace_id","project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "state_promotion_proposals_scope_state_index" ON "state_promotion_proposals" USING btree ("workspace_id","project_id","state");