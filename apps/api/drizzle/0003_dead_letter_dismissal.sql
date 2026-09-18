-- A failed delivery can be marked as looked-at. Nothing is removed: the row,
-- its body and its reason stay, and the mark can be lifted. The mark keeps
-- the failed-events list to what still needs a person.
ALTER TABLE "raw_events" ADD COLUMN "dismissed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "raw_events" ADD COLUMN "dismissed_by" uuid;--> statement-breakpoint
ALTER TABLE "raw_events" ADD CONSTRAINT "raw_events_dismissed_by_users_id_fk" FOREIGN KEY ("dismissed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
