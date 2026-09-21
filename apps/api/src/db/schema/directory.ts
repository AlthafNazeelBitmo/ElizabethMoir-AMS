import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  serial,
  text,
  time,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/** The branch a group belongs to. This is the axis role isolation turns on. */
export const BRANCHES = ["student", "staff"] as const;
export type Branch = (typeof BRANCHES)[number];

export const DEVICE_DIRECTIONS = ["entry", "exit", "both"] as const;
export type DeviceDirection = (typeof DEVICE_DIRECTIONS)[number];

/**
 * Forms and staff groupings. Names are editable by an administrator without a
 * deploy, so nothing anywhere may hardcode them — join on `branch` instead.
 */
export const groups = pgTable(
  "groups",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull().unique(),
    branch: text("branch").$type<Branch>().notNull(),
    displayOrder: integer("display_order").notNull(),
    /** Null inherits the global `late_threshold_default` setting. */
    lateThreshold: time("late_threshold"),
    /** False for External Staff: contractors must not appear in an absence list. */
    expectsAttendance: boolean("expects_attendance").notNull().default(true),
    isActive: boolean("is_active").notNull().default(true),
  },
  (t) => [
    check("groups_branch_valid", sql`${t.branch} in ('student', 'staff')`),
    index("groups_branch_order_idx").on(t.branch, t.displayOrder),
  ],
);

export const tutors = pgTable("tutors", {
  id: serial("id").primaryKey(),
  initials: text("initials").notNull().unique(),
  fullName: text("full_name"),
});

/**
 * The person directory. `enroll_no` is the number assigned on the physical
 * reader; it is the only identifier the upstream feed sends.
 *
 * It is unique school-wide, which holds while there is one reader. If a
 * second reader is ever enrolled independently rather than by ADMS's
 * "Transfer Template", the same number could denote two people and this
 * constraint would have to become (device, enroll_no). The Phase 0 report
 * reports cross-device reuse so the question is answered by evidence.
 */
export const people = pgTable(
  "people",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    enrollNo: text("enroll_no").notNull().unique(),
    fullName: text("full_name").notNull(),
    /** Nullable: a person may exist before anyone decides their group. */
    groupId: integer("group_id").references(() => groups.id),
    tutorId: integer("tutor_id").references(() => tutors.id),
    /** The school's own reference, distinct from the reader's number. */
    admissionNo: text("admission_no"),
    /**
     * The person's place in their group's list, as the school orders it —
     * head of school first, not alphabetically. Null for those with none,
     * who follow the ordered ones, by name.
     */
    displayOrder: integer("display_order"),
    /**
     * The school's own category for a member of staff — HOD, Teaching,
     * Admin, Service … — as its staff list writes it. Shown beside the
     * group wherever they are listed. Free text: a new category is a word
     * in the spreadsheet, not a deploy. Null for students.
     */
    category: text("category"),
    photoUrl: text("photo_url"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("people_group_display_order_idx").on(t.groupId, t.displayOrder),
    index("people_group_active_idx")
      .on(t.groupId)
      .where(sql`${t.isActive}`),
  ],
);

/**
 * Enrollment numbers seen in the feed that match no person. A scan from one
 * of these is still stored; this table is what makes it visible and fixable.
 */
export const unknownEnrollments = pgTable("unknown_enrollments", {
  enrollNo: text("enroll_no").primaryKey(),
  firstSeenAt: timestamp("first_seen_at", {
    withTimezone: true,
    mode: "date",
  }).notNull(),
  lastSeenAt: timestamp("last_seen_at", {
    withTimezone: true,
    mode: "date",
  }).notNull(),
  scanCount: integer("scan_count").notNull().default(1),
  resolvedPersonId: uuid("resolved_person_id").references(() => people.id),
});

/**
 * Readers. `direction` is set by an administrator from physical knowledge of
 * where the device is mounted; `trust_checking_status` is only enabled once
 * the Phase 0 report shows the flag means something on that device.
 */
export const devices = pgTable(
  "devices",
  {
    id: serial("id").primaryKey(),
    serial: text("serial").notNull().unique(),
    label: text("label"),
    location: text("location"),
    direction: text("direction")
      .$type<DeviceDirection>()
      .notNull()
      .default("both"),
    trustCheckingStatus: boolean("trust_checking_status")
      .notNull()
      .default(false),
    isActive: boolean("is_active").notNull().default(true),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true, mode: "date" }),
  },
  (t) => [
    check(
      "devices_direction_valid",
      sql`${t.direction} in ('entry', 'exit', 'both')`,
    ),
  ],
);

export type GroupRow = typeof groups.$inferSelect;
export type NewGroup = typeof groups.$inferInsert;
export type TutorRow = typeof tutors.$inferSelect;
export type PersonRow = typeof people.$inferSelect;
export type NewPerson = typeof people.$inferInsert;
export type DeviceRow = typeof devices.$inferSelect;
