-- A group may say when its people are expected to still be here. Someone
-- whose last departure is before it left early, and the register says so.
-- Null means the school makes no such rule for that group, which is every
-- group until somebody sets one.
ALTER TABLE "groups" ADD COLUMN "leave_cutoff" time;--> statement-breakpoint

-- Left early, decided when the day was computed, as late is.
ALTER TABLE "day_records" ADD COLUMN "left_early" boolean DEFAULT false NOT NULL;
