-- The school lists its staff in an order of its own — head of school first,
-- not alphabetically — and wants every list here to follow it. A person may
-- be given a position within their group; those without one follow, by
-- name. Nothing here is required: the students have no positions and stay
-- alphabetical within each form.
ALTER TABLE "people" ADD COLUMN "display_order" integer;--> statement-breakpoint
CREATE INDEX "people_group_display_order_idx" ON "people" USING btree ("group_id", "display_order");
