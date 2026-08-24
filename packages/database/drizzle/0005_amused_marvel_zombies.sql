ALTER TYPE "public"."event_publication_status" ADD VALUE 'quarantined';--> statement-breakpoint
ALTER TABLE "execution_events" ADD COLUMN "payload_hash" varchar(64);--> statement-breakpoint
UPDATE "execution_events"
SET "payload_hash" = encode(sha256(convert_to("payload"::text, 'UTF8')), 'hex');--> statement-breakpoint
ALTER TABLE "execution_events" ALTER COLUMN "payload_hash" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "execution_events" ADD COLUMN "next_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "execution_events" ADD COLUMN "quarantined_at" timestamp with time zone;
