ALTER TABLE "credential_secrets" ADD COLUMN "encryption_version" varchar(32) DEFAULT 'legacy-v0' NOT NULL;
