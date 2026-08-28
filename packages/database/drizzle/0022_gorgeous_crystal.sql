CREATE TYPE "public"."catalog_version_lifecycle" AS ENUM('draft', 'published', 'deprecated', 'revoked', 'superseded');--> statement-breakpoint
CREATE TABLE "agent_profile_versions" (
	"profile_version_id" varchar(64) PRIMARY KEY NOT NULL,
	"profile_id" varchar(64) NOT NULL,
	"version" integer NOT NULL,
	"revision" integer NOT NULL,
	"lifecycle" "catalog_version_lifecycle" NOT NULL,
	"content_digest" varchar(71) NOT NULL,
	"definition" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"lifecycle_metadata" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_profiles" (
	"profile_id" varchar(64) PRIMARY KEY NOT NULL,
	"display_name" varchar(128) NOT NULL,
	"ownership" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skill_versions" (
	"skill_version_id" varchar(64) PRIMARY KEY NOT NULL,
	"skill_id" varchar(64) NOT NULL,
	"revision" integer NOT NULL,
	"lifecycle" "catalog_version_lifecycle" NOT NULL,
	"manifest" jsonb NOT NULL,
	"content" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"lifecycle_metadata" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skills" (
	"skill_id" varchar(64) PRIMARY KEY NOT NULL,
	"display_name" varchar(128) NOT NULL,
	"ownership" jsonb NOT NULL,
	"provenance" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_profile_versions" ADD CONSTRAINT "agent_profile_versions_profile_id_agent_profiles_profile_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."agent_profiles"("profile_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_versions" ADD CONSTRAINT "skill_versions_skill_id_skills_skill_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("skill_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_profile_versions_number_unique" ON "agent_profile_versions" USING btree ("profile_id","version");--> statement-breakpoint
CREATE INDEX "agent_profile_versions_profile_index" ON "agent_profile_versions" USING btree ("profile_id");--> statement-breakpoint
CREATE INDEX "skill_versions_skill_index" ON "skill_versions" USING btree ("skill_id");