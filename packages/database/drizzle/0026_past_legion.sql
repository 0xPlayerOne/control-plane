CREATE TABLE "profile_migrations" (
	"export_id" varchar(128) PRIMARY KEY NOT NULL,
	"manifest_digest" varchar(71) NOT NULL,
	"source_profile" varchar(32) NOT NULL,
	"destination_profile" varchar(32) NOT NULL,
	"record_count" integer NOT NULL,
	"artifact_count" integer NOT NULL,
	"provenance" jsonb NOT NULL,
	"applied_at" timestamp with time zone NOT NULL
);
