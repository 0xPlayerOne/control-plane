CREATE TABLE "credential_secrets" (
	"locator" varchar(256) NOT NULL,
	"version" varchar(64) NOT NULL,
	"ciphertext" text NOT NULL,
	"iv" varchar(64) NOT NULL,
	"auth_tag" varchar(64) NOT NULL,
	"key_reference" varchar(128) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credential_secrets_locator_version_pk" PRIMARY KEY("locator","version")
);
