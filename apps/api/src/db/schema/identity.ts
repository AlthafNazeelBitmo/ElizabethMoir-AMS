import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  inet,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/** The two roles in the system. A `student_only` user must never see staff. */
export const USER_ROLES = ["full", "student_only"] as const;
export type UserRole = (typeof USER_ROLES)[number];

/**
 * Operator accounts. There is no self-registration: an administrator creates
 * accounts, and every new account must change its password on first login.
 *
 * Email is `text` rather than the spec's `citext`. citext is a contrib
 * extension and is not available everywhere the test suite runs, and a
 * normalise-on-write column is stronger anyway: the CHECK guarantees that
 * every stored address is already lowercased, so a duplicate cannot enter
 * through raw SQL that bypasses the application's normalisation.
 */
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    fullName: text("full_name").notNull(),
    role: text("role").$type<UserRole>().notNull(),
    isActive: boolean("is_active").notNull().default(true),

    /** Consecutive failures since the last success. Reset on successful login. */
    failedAttempts: integer("failed_attempts").notNull().default(0),
    lockedUntil: timestamp("locked_until", {
      withTimezone: true,
      mode: "date",
    }),
    lastLoginAt: timestamp("last_login_at", {
      withTimezone: true,
      mode: "date",
    }),

    mustChangePassword: boolean("must_change_password").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check("users_role_valid", sql`${t.role} in ('full', 'student_only')`),
    check("users_email_lowercase", sql`${t.email} = lower(${t.email})`),
    check("users_email_shaped", sql`${t.email} like '%_@_%._%'`),
  ],
);

/**
 * Server-side sessions. The cookie carries a random token; only its SHA-256
 * is stored, so a database leak does not yield usable session cookies.
 *
 * `csrf_hash` is not in the specification's table list. It is required to
 * implement the mandated CSRF token in a way that is bound to the session:
 * the raw CSRF value goes to a readable cookie, the client echoes it in a
 * header, and the server compares its hash against this column. Binding it
 * to the session means an attacker who can only set cookies cannot forge a
 * matching pair.
 */
export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    csrfHash: text("csrf_hash").notNull(),

    issuedAt: timestamp("issued_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    /** Absolute expiry: 12 hours after issue, never extended. */
    expiresAt: timestamp("expires_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    /** Touched on each request; 8 hours of inactivity ends the session. */
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),

    ip: inet("ip"),
    userAgent: text("user_agent"),
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
  },
  (t) => [
    index("sessions_user_idx").on(t.userId),
    index("sessions_expires_idx").on(t.expiresAt),
  ],
);

export type UserRow = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type SessionRow = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
