-- When the person last moved through a reader that day: the time of the
-- last scan that counted, in or out. The live register lists the latest
-- movement first, so the last person to arrive or leave is at the top.
-- Neither first_in nor last_out says this on its own - someone who left
-- at lunch and came back has a last_out of nothing - so it is kept.
-- Existing days are filled from what they have.
ALTER TABLE "day_records" ADD COLUMN "last_movement_at" timestamp with time zone;--> statement-breakpoint
UPDATE "day_records" SET "last_movement_at" = greatest("first_in", "last_out");
