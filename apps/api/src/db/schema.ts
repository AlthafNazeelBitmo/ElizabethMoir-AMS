import { sql } from "drizzle-orm";
import {
  bigserial,
  index,
  inet,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/**
 * Every webhook delivery, verbatim, before any interpretation.
 *
 * This table is permanent (spec §2): it is the forensic record and the
 * source for replay. Nothing is ever deleted from it by the application.
 *
 * Beyond the spec's column list we also keep `method` and `body_bytes` so an
 * oversize discard can be recorded without keeping the body, and so the
 * Phase 0 report can size the feed.
 */
export const rawEvents = pgTable(
  "raw_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    receivedAt: timestamp("received_at", { withTimezone: true, mode: "date" }).notNull(),
    remoteIp: inet("remote_ip"),
    method: text("method"),
    headers: jsonb("headers").$type<Record<string, string | string[] | undefined>>(),
    contentType: text("content_type"),
    bodyBytes: integer("body_bytes"),
    bodyText: text("body_text"),
    bodyJson: jsonb("body_json").$type<unknown>(),
    batchSize: integer("batch_size"),
    parseError: text("parse_error"),
    processedAt: timestamp("processed_at", { withTimezone: true, mode: "date" }),
    processError: text("process_error"),
  },
  (t) => [
    index("raw_events_received_at_idx").on(t.receivedAt.desc()),
    index("raw_events_unprocessed_idx").on(t.processedAt).where(sql`${t.processedAt} is null`),
  ],
);

export type RawEventRow = typeof rawEvents.$inferSelect;
export type NewRawEvent = typeof rawEvents.$inferInsert;
