CREATE TABLE "runtime_inventory_checkpoints" (
	"runtime_node_ref_id" varchar(30) PRIMARY KEY NOT NULL,
	"workspace_id" varchar(30) NOT NULL,
	"snapshot_version" bigint NOT NULL,
	"snapshot_digest" varchar(71) NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"active_runtime_refs" jsonb NOT NULL,
	"revision" bigint NOT NULL,
	CONSTRAINT "runtime_inventory_checkpoints_snapshot_version_check" CHECK ("runtime_inventory_checkpoints"."snapshot_version" > 0),
	CONSTRAINT "runtime_inventory_checkpoints_revision_check" CHECK ("runtime_inventory_checkpoints"."revision" > 0),
	CONSTRAINT "runtime_inventory_checkpoints_active_refs_check" CHECK (jsonb_typeof("runtime_inventory_checkpoints"."active_runtime_refs") = 'array')
);
