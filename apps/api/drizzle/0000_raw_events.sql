CREATE TABLE "raw_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"remote_ip" "inet",
	"method" text,
	"headers" jsonb,
	"content_type" text,
	"body_bytes" integer,
	"body_text" text,
	"body_json" jsonb,
	"batch_size" integer,
	"parse_error" text,
	"processed_at" timestamp with time zone,
	"process_error" text
);
--> statement-breakpoint
CREATE INDEX "raw_events_received_at_idx" ON "raw_events" USING btree ("received_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "raw_events_unprocessed_idx" ON "raw_events" USING btree ("processed_at") WHERE "raw_events"."processed_at" is null;