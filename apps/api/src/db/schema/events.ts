import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  check,
  date,
  index,
  inet,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { people } from "./directory.js";
import { users } from "./identity.js";

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

/** How a scan's direction was decided. Recorded so the rule can be audited. */
export const DIRECTIONS = ["in", "out", "unknown"] as const;
export type Direction = (typeof DIRECTIONS)[number];

export const DIRECTION_SOURCES = ["device", "status", "sequence", "manual"] as const;
export type DirectionSource = (typeof DIRECTION_SOURCES)[number];

/**
 * One interpreted scan. Derived from a raw_event, never written directly by
 * anything else.
 *
 * `att_time` is the instant, normalised to UTC using the resolved timezone;
 * `att_time_local` keeps the naive value exactly as transmitted, so a later
 * correction to the timezone can be reapplied without consulting the feed.
 */
export const scans = pgTable(
  "scans",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    enrollNo: text("enroll_no").notNull(),
    /** Null when the enrollment number matches nobody: never discard the scan. */
    personId: uuid("person_id").references(() => people.id),

    attTime: timestamp("att_time", { withTimezone: true, mode: "date" }).notNull(),
    attTimeLocal: timestamp("att_time_local", { withTimezone: false, mode: "string" }).notNull(),

    checkingStatus: text("checking_status"),
    verifyType: text("verify_type"),
    deviceSerial: text("device_serial").notNull(),

    direction: text("direction").$type<Direction>().notNull(),
    directionSource: text("direction_source").$type<DirectionSource>().notNull(),

    /** sha256(enroll|att_time_local|device|status). Makes replay idempotent. */
    dedupeKey: text("dedupe_key").notNull().unique(),
    rawEventId: bigint("raw_event_id", { mode: "number" }).references(() => rawEvents.id),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    check("scans_direction_valid", sql`${t.direction} in ('in', 'out', 'unknown')`),
    check(
      "scans_direction_source_valid",
      sql`${t.directionSource} in ('device', 'status', 'sequence', 'manual')`,
    ),
    index("scans_att_time_idx").on(t.attTime.desc()),
    index("scans_person_time_idx").on(t.personId, t.attTime.desc()),
    index("scans_enroll_time_idx").on(t.enrollNo, t.attTime.desc()),
  ],
);

export const DAY_STATUSES = ["on_site", "departed", "late", "absent", "not_expected"] as const;
export type DayStatus = (typeof DAY_STATUSES)[number];

/**
 * The derived state of one person on one day. Recomputed on every scan that
 * affects it, and nightly for everyone on a school day.
 */
export const dayRecords = pgTable(
  "day_records",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id),
    date: date("date", { mode: "string" }).notNull(),

    firstIn: timestamp("first_in", { withTimezone: true, mode: "date" }),
    lastOut: timestamp("last_out", { withTimezone: true, mode: "date" }),

    status: text("status").$type<DayStatus>().notNull(),
    /** Separate from status so "late" can combine with on_site or departed. */
    isLate: boolean("is_late").notNull().default(false),
    scanCount: integer("scan_count").notNull().default(0),
    hasManualEdit: boolean("has_manual_edit").notNull().default(false),
    computedAt: timestamp("computed_at", { withTimezone: true, mode: "date" }),
  },
  (t) => [
    unique("day_records_person_date_key").on(t.personId, t.date),
    check(
      "day_records_status_valid",
      sql`${t.status} in ('on_site', 'departed', 'late', 'absent', 'not_expected')`,
    ),
    index("day_records_date_status_idx").on(t.date, t.status),
  ],
);

/** Every manual correction to a derived day, with the required reason. */
export const manualAdjustments = pgTable("manual_adjustments", {
  id: uuid("id").primaryKey().defaultRandom(),
  dayRecordId: bigint("day_record_id", { mode: "number" })
    .notNull()
    .references(() => dayRecords.id),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  field: text("field").notNull(),
  oldValue: text("old_value"),
  newValue: text("new_value"),
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

export type ScanRow = typeof scans.$inferSelect;
export type NewScan = typeof scans.$inferInsert;
export type DayRecordRow = typeof dayRecords.$inferSelect;
export type NewDayRecord = typeof dayRecords.$inferInsert;
