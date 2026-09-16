import { sql } from "drizzle-orm";
import {
  bigserial,
  check,
  date,
  index,
  inet,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./identity.js";

export const CALENDAR_DAY_TYPES = [
  "school_day",
  "weekend",
  "holiday",
  "exception",
] as const;
export type CalendarDayType = (typeof CALENDAR_DAY_TYPES)[number];

/**
 * Which dates are school days. Absence is only meaningful against this: a
 * date absent from the table is treated as not-a-school-day, so an empty
 * calendar can never mark the whole school absent.
 */
export const calendarDays = pgTable(
  "calendar_days",
  {
    date: date("date", { mode: "string" }).primaryKey(),
    type: text("type").$type<CalendarDayType>().notNull(),
    label: text("label"),
  },
  (t) => [
    check(
      "calendar_days_type_valid",
      sql`${t.type} in ('school_day', 'weekend', 'holiday', 'exception')`,
    ),
  ],
);

/**
 * Operational rules: timezone, late thresholds, duplicate window, rollover.
 * Editable in admin, never hardcoded anywhere.
 */
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<unknown>().notNull(),
  updatedBy: uuid("updated_by").references(() => users.id),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
});

/**
 * Append-only record of everything that matters. The application exposes no
 * update or delete path for any role, and a database trigger enforces that
 * independently of application discipline — see the migration.
 *
 * `user_id` is nullable and ON DELETE SET NULL rather than cascading: a
 * deactivated user's audit trail must survive them.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: uuid("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    action: text("action").notNull(),
    entity: text("entity"),
    entityId: text("entity_id"),
    before: jsonb("before").$type<unknown>(),
    after: jsonb("after").$type<unknown>(),
    ip: inet("ip"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("audit_log_created_idx").on(t.createdAt.desc()),
    index("audit_log_user_created_idx").on(t.userId, t.createdAt.desc()),
    index("audit_log_action_idx").on(t.action),
  ],
);

export type AuditLogRow = typeof auditLog.$inferSelect;
export type NewAuditLog = typeof auditLog.$inferInsert;
export type SettingRow = typeof settings.$inferSelect;
