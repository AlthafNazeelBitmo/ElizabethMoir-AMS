import { randomBytes } from "node:crypto";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  isNotNull,
  isNull,
  lte,
  sql,
} from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { AUDIT_ACTIONS, writeAudit } from "../audit.js";
import {
  requireRole,
  requireSession,
  type CookieContext,
} from "../auth/http.js";
import { checkPasswordStrength, hashPassword } from "../auth/password.js";
import type { AuthService } from "../auth/service.js";
import type { Db } from "../db/client.js";
import {
  CALENDAR_DAY_TYPES,
  USER_ROLES,
  auditLog,
  calendarDays,
  rawEvents,
  sessions,
  users,
} from "../db/schema/index.js";
import { parseStatusMap } from "../domain/direction.js";
import { isValidTimeZone, parseTimeOfDay } from "../domain/time.js";
import { auditLogToCsv } from "./audit-csv.js";
import type { ScanProcessor } from "../processing/processor.js";
import {
  asSchoolName,
  DEFAULT_SETTINGS,
  SCHOOL_NAME_MAX_LENGTH,
  SETTING_KEYS,
  type SettingsService,
} from "../settings/service.js";

export interface AdminSystemRoutesOptions {
  db: Db;
  auth: AuthService;
  cookies: CookieContext;
  settings: SettingsService;
  processor: ScanProcessor;
}

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

const pagination = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_PAGE_SIZE)
    .default(DEFAULT_PAGE_SIZE),
});

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.");

/**
 * Running the system: the accounts, the rules, the calendar, the record of
 * what happened, and the deliveries that failed.
 *
 * Everything here is `full` role only. Several of these endpoints can lock
 * the school out of its own system, so the guards against that are as much
 * a part of the feature as the feature is.
 */
export const adminSystemRoutes: FastifyPluginAsync<
  AdminSystemRoutesOptions
> = async (app, { db, auth, cookies, settings, processor }) => {
  const preHandler = [requireSession({ auth, cookies }), requireRole("full")];

  // ── Users ───────────────────────────────────────────────────────────────

  app.get("/api/admin/users", { preHandler }, async (req, reply) => {
    const parsed = pagination.safeParse(req.query);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "invalid_query", message: "Check the page values." });
    }
    const { page, limit } = parsed.data;
    const rows = await db
      .select({
        id: users.id,
        email: users.email,
        fullName: users.fullName,
        role: users.role,
        isActive: users.isActive,
        mustChangePassword: users.mustChangePassword,
        lastLoginAt: users.lastLoginAt,
        lockedUntil: users.lockedUntil,
        failedAttempts: users.failedAttempts,
        createdAt: users.createdAt,
      })
      .from(users)
      .orderBy(asc(users.email))
      .limit(limit)
      .offset((page - 1) * limit);
    const [total] = await db.select({ n: count() }).from(users);
    return reply.send({ users: rows, page, limit, total: total?.n ?? 0 });
  });

  const createUserBody = z.object({
    email: z.string().trim().toLowerCase().email().max(320),
    fullName: z.string().trim().min(1).max(200),
    role: z.enum(USER_ROLES),
  });

  app.post("/api/admin/users", { preHandler }, async (req, reply) => {
    const parsed = createUserBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_request",
        message: "Give an email address, a name and a role.",
        problems: parsed.error.issues.map(
          (i) => `${i.path.join(".")}: ${i.message}`,
        ),
      });
    }

    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, parsed.data.email))
      .limit(1);
    if (existing) {
      return reply
        .code(409)
        .send({
          error: "duplicate",
          message: "That email address already has an account.",
        });
    }

    const password = generatePassword();
    const [row] = await db
      .insert(users)
      .values({
        email: parsed.data.email,
        fullName: parsed.data.fullName,
        role: parsed.data.role,
        passwordHash: await hashPassword(password),
        mustChangePassword: true,
      })
      .returning({ id: users.id, email: users.email, role: users.role });

    await writeAudit(db, req.log, {
      action: "user_created",
      userId: req.auth!.userId,
      entity: "user",
      entityId: row!.id,
      after: { email: row!.email, role: row!.role },
      ip: req.ip || null,
      userAgent: req.headers["user-agent"] ?? null,
    });

    // Shown once and never recoverable, like the command-line tool.
    return reply.code(201).send({ user: row, temporaryPassword: password });
  });

  const patchUserBody = z.object({
    fullName: z.string().trim().min(1).max(200).optional(),
    role: z.enum(USER_ROLES).optional(),
    isActive: z.boolean().optional(),
    resetPassword: z.literal(true).optional(),
  });

  app.patch<{ Params: { id: string } }>(
    "/api/admin/users/:id",
    { preHandler },
    async (req, reply) => {
      const parsed = patchUserBody.safeParse(req.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "invalid_request", message: "Check the values." });
      }
      const [before] = await db
        .select()
        .from(users)
        .where(eq(users.id, req.params.id))
        .limit(1);
      if (!before)
        return reply
          .code(404)
          .send({ error: "not_found", message: "No such account." });

      const isSelf = before.id === req.auth!.userId;

      // You cannot deactivate yourself or change your own role. Both are
      // ways to lock yourself out mid-session by accident, and neither has
      // a legitimate use: ask another administrator.
      if (isSelf && parsed.data.isActive === false) {
        return reply.code(409).send({
          error: "cannot_deactivate_self",
          message:
            "You cannot deactivate your own account. Ask another administrator.",
        });
      }
      if (
        isSelf &&
        parsed.data.role !== undefined &&
        parsed.data.role !== before.role
      ) {
        return reply.code(409).send({
          error: "cannot_change_own_role",
          message:
            "You cannot change your own role. Ask another administrator.",
        });
      }

      // Those two guards are what keep the school in its own system: the
      // person making the change always remains an active administrator, so
      // there is always at least one way back in. A separate
      // "last administrator" check would be unreachable, and unreachable
      // safety code is worse than none — it reads as protection nobody has
      // tested.

      const patch: Record<string, unknown> = { updatedAt: new Date() };
      if (parsed.data.fullName !== undefined)
        patch["fullName"] = parsed.data.fullName;
      if (parsed.data.role !== undefined) patch["role"] = parsed.data.role;
      if (parsed.data.isActive !== undefined)
        patch["isActive"] = parsed.data.isActive;

      let temporaryPassword: string | undefined;
      if (parsed.data.resetPassword) {
        temporaryPassword = generatePassword();
        patch["passwordHash"] = await hashPassword(temporaryPassword);
        patch["mustChangePassword"] = true;
        // A reset must also end whatever sessions exist, or the old holder
        // keeps their access.
        patch["failedAttempts"] = 0;
        patch["lockedUntil"] = null;
      }

      const [after] = await db
        .update(users)
        .set(patch)
        .where(eq(users.id, req.params.id))
        .returning({
          id: users.id,
          email: users.email,
          fullName: users.fullName,
          role: users.role,
          isActive: users.isActive,
        });

      if (parsed.data.resetPassword || parsed.data.isActive === false) {
        await db
          .update(sessions)
          .set({ revokedAt: new Date() })
          .where(
            and(
              eq(sessions.userId, req.params.id),
              sql`${sessions.revokedAt} is null`,
            ),
          );
      }

      await writeAudit(db, req.log, {
        action:
          parsed.data.isActive === false ? "user_deactivated" : "user_modified",
        userId: req.auth!.userId,
        entity: "user",
        entityId: req.params.id,
        before: {
          role: before.role,
          isActive: before.isActive,
          fullName: before.fullName,
        },
        after: { ...after, passwordReset: Boolean(parsed.data.resetPassword) },
        ip: req.ip || null,
        userAgent: req.headers["user-agent"] ?? null,
      });

      return reply.send({
        user: after,
        ...(temporaryPassword ? { temporaryPassword } : {}),
      });
    },
  );

  // ── Attendance rules ────────────────────────────────────────────────────

  app.get("/api/admin/settings", { preHandler }, async (_req, reply) => {
    const current = await settings.get();
    return reply.send({
      settings: {
        school_name: current.schoolName,
        timezone: current.timezone,
        late_threshold_default: formatTimeOfDay(current.lateThresholdDefault),
        duplicate_window_seconds: current.duplicateWindowSeconds,
        day_rollover_time: formatTimeOfDay(current.dayRolloverTime),
        checking_status_map: current.checkingStatusMap,
        absence_decided_after: formatTimeOfDay(current.absenceDecidedAfter),
      },
      defaults: {
        school_name: DEFAULT_SETTINGS.schoolName,
        timezone: DEFAULT_SETTINGS.timezone,
        late_threshold_default: formatTimeOfDay(
          DEFAULT_SETTINGS.lateThresholdDefault,
        ),
        duplicate_window_seconds: DEFAULT_SETTINGS.duplicateWindowSeconds,
        day_rollover_time: formatTimeOfDay(DEFAULT_SETTINGS.dayRolloverTime),
        checking_status_map: DEFAULT_SETTINGS.checkingStatusMap,
        absence_decided_after: formatTimeOfDay(
          DEFAULT_SETTINGS.absenceDecidedAfter,
        ),
      },
    });
  });

  app.patch("/api/admin/settings", { preHandler }, async (req, reply) => {
    const body = req.body;
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return reply
        .code(400)
        .send({
          error: "invalid_request",
          message: "Send an object of settings.",
        });
    }

    const problems: string[] = [];
    const accepted: Array<{ key: string; value: unknown }> = [];

    for (const [key, value] of Object.entries(
      body as Record<string, unknown>,
    )) {
      const validation = validateSetting(key, value);
      if (validation.ok) accepted.push({ key, value: validation.value });
      else problems.push(validation.problem);
    }

    // All or nothing: half-applied rules would make the register's figures
    // mean something nobody chose.
    if (problems.length > 0) {
      return reply.code(422).send({
        error: "invalid_settings",
        message:
          "Nothing was changed. Correct the values listed and try again.",
        problems,
      });
    }
    if (accepted.length === 0) {
      return reply
        .code(400)
        .send({ error: "invalid_request", message: "No settings were given." });
    }

    const before = await settings.get();
    for (const entry of accepted) {
      await settings.set(entry.key, entry.value, req.auth!.userId);
    }
    const after = await settings.get();

    await writeAudit(db, req.log, {
      action: "attendance_rule_changed",
      userId: req.auth!.userId,
      entity: "settings",
      before,
      after,
      ip: req.ip || null,
      userAgent: req.headers["user-agent"] ?? null,
    });

    return reply.send({ changed: accepted.map((a) => a.key) });
  });

  // ── Calendar ────────────────────────────────────────────────────────────

  app.get("/api/admin/calendar", { preHandler }, async (req, reply) => {
    const parsed = z
      .object({ from: dateString, to: dateString })
      .safeParse(req.query);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "invalid_query", message: "Give from and to dates." });
    }
    const rows = await db
      .select()
      .from(calendarDays)
      .where(
        and(
          gte(calendarDays.date, parsed.data.from),
          lte(calendarDays.date, parsed.data.to),
        ),
      )
      .orderBy(asc(calendarDays.date));
    return reply.send({ days: rows });
  });

  const calendarBody = z.object({
    from: dateString,
    to: dateString,
    type: z.enum(CALENDAR_DAY_TYPES),
    label: z.string().trim().max(200).optional(),
    /** Skip Saturdays and Sundays — how a term is usually entered. */
    weekdaysOnly: z.boolean().default(false),
  });

  app.post("/api/admin/calendar", { preHandler }, async (req, reply) => {
    const parsed = calendarBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_request",
        message: "Give a date range and a type.",
        problems: parsed.error.issues.map(
          (i) => `${i.path.join(".")}: ${i.message}`,
        ),
      });
    }
    const { from, to, type, label, weekdaysOnly } = parsed.data;
    if (from > to) {
      return reply
        .code(400)
        .send({
          error: "invalid_request",
          message: "The start date must not be after the end.",
        });
    }
    const dates = datesBetween(from, to);
    if (dates.length > 400) {
      return reply
        .code(400)
        .send({
          error: "range_too_long",
          message: "Set at most 400 days at a time.",
        });
    }

    const rows = dates
      .filter((date) => !weekdaysOnly || !isWeekend(date))
      .map((date) => ({ date, type, label: label ?? null }));
    if (rows.length === 0) {
      return reply
        .code(400)
        .send({
          error: "invalid_request",
          message: "That range has no days in it.",
        });
    }

    await db
      .insert(calendarDays)
      .values(rows)
      .onConflictDoUpdate({
        target: calendarDays.date,
        set: { type: sql`excluded.type`, label: sql`excluded.label` },
      });

    await writeAudit(db, req.log, {
      action: "attendance_rule_changed",
      userId: req.auth!.userId,
      entity: "calendar",
      after: { from, to, type, label, weekdaysOnly, days: rows.length },
      ip: req.ip || null,
      userAgent: req.headers["user-agent"] ?? null,
    });

    return reply.send({ days: rows.length });
  });

  // ── Audit log ───────────────────────────────────────────────────────────

  const auditQuery = pagination.extend({
    from: dateString.optional(),
    to: dateString.optional(),
    user: z.string().uuid().optional(),
    action: z.enum(AUDIT_ACTIONS).optional(),
    format: z.enum(["json", "csv"]).default("json"),
  });

  /** More rows than this in one file is a sign the dates need narrowing. */
  const MAX_AUDIT_EXPORT_ROWS = 20_000;

  app.get("/api/admin/audit", { preHandler }, async (req, reply) => {
    const parsed = auditQuery.safeParse(req.query);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "invalid_query", message: "Check the filters." });
    }
    const { page, limit, from, to, user, action, format } = parsed.data;

    const conditions = [
      from
        ? gte(auditLog.createdAt, new Date(`${from}T00:00:00.000Z`))
        : undefined,
      to ? lte(auditLog.createdAt, new Date(`${to}T23:59:59.999Z`)) : undefined,
      user ? eq(auditLog.userId, user) : undefined,
      action ? eq(auditLog.action, action) : undefined,
    ].filter((c): c is NonNullable<typeof c> => c !== undefined);
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const selectEntries = () =>
      db
        .select({
          id: auditLog.id,
          action: auditLog.action,
          entity: auditLog.entity,
          entityId: auditLog.entityId,
          before: auditLog.before,
          after: auditLog.after,
          createdAt: auditLog.createdAt,
          userEmail: users.email,
          userName: users.fullName,
        })
        .from(auditLog)
        .leftJoin(users, eq(users.id, auditLog.userId))
        .where(where)
        .orderBy(desc(auditLog.createdAt), desc(auditLog.id));

    const [total] = await db.select({ n: count() }).from(auditLog).where(where);

    if (format === "csv") {
      if ((total?.n ?? 0) > MAX_AUDIT_EXPORT_ROWS) {
        return reply.code(400).send({
          error: "too_many_rows",
          message: `That is ${total?.n} entries. Narrow the dates to ${MAX_AUDIT_EXPORT_ROWS} or fewer.`,
        });
      }
      const entries = await selectEntries().limit(MAX_AUDIT_EXPORT_ROWS);

      // Exporting the log is itself something the log should say happened.
      await writeAudit(db, req.log, {
        action: "audit_export",
        userId: req.auth!.userId,
        entity: "audit_log",
        after: { from, to, user, action, rows: entries.length },
        ip: req.ip || null,
        userAgent: req.headers["user-agent"] ?? null,
      });

      const parts: string[] = [];
      if (from || to) parts.push(`${from ?? "start"} to ${to ?? "now"}`);
      if (action) parts.push(`Action: ${action}`);
      if (user) parts.push(`User: ${entries[0]?.userEmail ?? user}`);
      const csv = auditLogToCsv(entries, {
        filtersDescription:
          parts.length > 0 ? `Filters — ${parts.join("; ")}` : "Every entry",
        generatedAt: new Date(),
      });
      const stamp = new Date().toISOString().slice(0, 10);
      return reply
        .code(200)
        .header("content-type", "text/csv; charset=utf-8")
        .header(
          "content-disposition",
          `attachment; filename="audit-log-${stamp}.csv"`,
        )
        .header("cache-control", "no-store")
        .send(csv);
    }

    const rows = await selectEntries()
      .limit(limit)
      .offset((page - 1) * limit);
    // The IP is deliberately not returned: it is recorded for investigation,
    // not for routine display next to a person's name.
    return reply.send({
      entries: rows,
      page,
      limit,
      total: total?.n ?? 0,
      actions: AUDIT_ACTIONS,
    });
  });

  // ── Failed deliveries ───────────────────────────────────────────────────

  const deadLetterQuery = pagination.extend({
    includeDismissed: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),
  });

  app.get("/api/admin/dead-letter", { preHandler }, async (req, reply) => {
    const parsed = deadLetterQuery.safeParse(req.query);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "invalid_query", message: "Check the page values." });
    }
    const { page, limit, includeDismissed } = parsed.data;
    // A dismissed failure is still a failure — it stays, body and reason —
    // but it has been looked at, and the list is for what still needs a
    // person.
    const where = includeDismissed
      ? isNotNull(rawEvents.processError)
      : and(isNotNull(rawEvents.processError), isNull(rawEvents.dismissedAt));

    const rows = await db
      .select({
        id: rawEvents.id,
        receivedAt: rawEvents.receivedAt,
        contentType: rawEvents.contentType,
        batchSize: rawEvents.batchSize,
        parseError: rawEvents.parseError,
        processError: rawEvents.processError,
        processedAt: rawEvents.processedAt,
        dismissedAt: rawEvents.dismissedAt,
        dismissedBy: users.fullName,
        // The body is shown truncated: it is the evidence, but a megabyte of
        // it in a list is not useful.
        bodyPreview: sql<string>`left(coalesce(${rawEvents.bodyText}, ''), 500)`,
      })
      .from(rawEvents)
      .leftJoin(users, eq(users.id, rawEvents.dismissedBy))
      .where(where)
      .orderBy(desc(rawEvents.receivedAt))
      .limit(limit)
      .offset((page - 1) * limit);

    const [total] = await db
      .select({ n: count() })
      .from(rawEvents)
      .where(where);
    return reply.send({ failures: rows, page, limit, total: total?.n ?? 0 });
  });

  app.post<{ Params: { id: string } }>(
    "/api/admin/dead-letter/:id/replay",
    { preHandler },
    async (req, reply) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) {
        return reply
          .code(400)
          .send({ error: "invalid_request", message: "Bad delivery id." });
      }
      const [existing] = await db
        .select({ id: rawEvents.id })
        .from(rawEvents)
        .where(eq(rawEvents.id, id))
        .limit(1);
      if (!existing) {
        return reply
          .code(404)
          .send({ error: "not_found", message: "No such delivery." });
      }

      // Marking it outstanding again is the whole of a replay: the processor
      // is idempotent, so a delivery that partly succeeded will not double
      // anything up when it runs again.
      await db
        .update(rawEvents)
        .set({ processedAt: null, processError: null })
        .where(eq(rawEvents.id, id));

      const result = await processor.processPending();

      const [after] = await db
        .select({ processError: rawEvents.processError })
        .from(rawEvents)
        .where(eq(rawEvents.id, id))
        .limit(1);

      await writeAudit(db, req.log, {
        action: "dead_letter_replay",
        userId: req.auth!.userId,
        entity: "raw_event",
        entityId: String(id),
        after: { ...result, stillFailing: after?.processError !== null },
        ip: req.ip || null,
        userAgent: req.headers["user-agent"] ?? null,
      });

      return reply.send({
        result,
        resolved: after?.processError === null,
        processError: after?.processError ?? null,
      });
    },
  );

  // Set a failure aside, or take it back. Nothing is deleted: the queue is
  // append-only for the same reason the audit log is.
  app.patch<{ Params: { id: string } }>(
    "/api/admin/dead-letter/:id",
    { preHandler },
    async (req, reply) => {
      const id = Number(req.params.id);
      const body = z
        .object({ dismissed: z.boolean() })
        .safeParse(req.body);
      if (!Number.isInteger(id) || !body.success) {
        return reply.code(400).send({
          error: "invalid_request",
          message: "Say whether the delivery is dismissed.",
        });
      }
      const [existing] = await db
        .select({ id: rawEvents.id, dismissedAt: rawEvents.dismissedAt })
        .from(rawEvents)
        .where(and(eq(rawEvents.id, id), isNotNull(rawEvents.processError)))
        .limit(1);
      if (!existing) {
        return reply
          .code(404)
          .send({ error: "not_found", message: "No such failed delivery." });
      }

      const dismissed = body.data.dismissed;
      await db
        .update(rawEvents)
        .set(
          dismissed
            ? { dismissedAt: new Date(), dismissedBy: req.auth!.userId }
            : { dismissedAt: null, dismissedBy: null },
        )
        .where(eq(rawEvents.id, id));

      await writeAudit(db, req.log, {
        action: dismissed ? "dead_letter_dismissed" : "dead_letter_restored",
        userId: req.auth!.userId,
        entity: "raw_event",
        entityId: String(id),
        before: { dismissed: existing.dismissedAt !== null },
        after: { dismissed },
        ip: req.ip || null,
        userAgent: req.headers["user-agent"] ?? null,
      });

      return reply.send({ id, dismissed });
    },
  );
};

// ── helpers ───────────────────────────────────────────────────────────────

type SettingValidation =
  { ok: true; value: unknown } | { ok: false; problem: string };

/**
 * Settings are what every attendance figure is computed from, so a bad one
 * is not a cosmetic problem. Each is validated by the same rules the
 * settings service uses to read it back.
 */
export function validateSetting(
  key: string,
  value: unknown,
): SettingValidation {
  switch (key) {
    case SETTING_KEYS.schoolName: {
      const name = asSchoolName(value);
      return name !== null
        ? { ok: true, value: name }
        : {
            ok: false,
            problem: `${key}: give a name of 1 to ${SCHOOL_NAME_MAX_LENGTH} characters.`,
          };
    }

    case SETTING_KEYS.timezone:
      return typeof value === "string" && isValidTimeZone(value)
        ? { ok: true, value }
        : {
            ok: false,
            problem: `timezone: "${String(value)}" is not an IANA timezone name.`,
          };

    case SETTING_KEYS.lateThresholdDefault:
    case SETTING_KEYS.dayRolloverTime:
    case SETTING_KEYS.absenceDecidedAfter:
      return typeof value === "string" && parseTimeOfDay(value) !== null
        ? { ok: true, value }
        : {
            ok: false,
            problem: `${key}: "${String(value)}" is not a time of day (HH:mm).`,
          };

    case SETTING_KEYS.duplicateWindowSeconds: {
      const n = typeof value === "number" ? value : Number(value);
      return Number.isInteger(n) && n > 0 && n <= 3600
        ? { ok: true, value: n }
        : {
            ok: false,
            problem: `${key}: give a whole number of seconds between 1 and 3600.`,
          };
    }

    case SETTING_KEYS.checkingStatusMap: {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return {
          ok: false,
          problem: `${key}: give an object mapping each status value to in or out.`,
        };
      }
      const cleaned = parseStatusMap(value);
      const given = Object.keys(value as Record<string, unknown>);
      const dropped = given.filter((k) => !(k in cleaned));
      return dropped.length === 0
        ? { ok: true, value: cleaned }
        : {
            ok: false,
            problem: `${key}: ${dropped.join(", ")} must map to "in" or "out".`,
          };
    }

    default:
      return { ok: false, problem: `${key} is not a setting.` };
  }
}

/** Readable, unambiguous, long enough that the password policy accepts it. */
function generatePassword(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789"; // no l/1/o/0
  const bytes = randomBytes(20);
  const password = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join(
    "",
  );
  // Belt and braces: a generated password must never fail our own policy.
  return checkPasswordStrength(password).ok
    ? password
    : `${password}-${Date.now()}`;
}

function formatTimeOfDay(
  time: { hour: number; minute: number; second: number } | null,
): string | null {
  if (time === null) return null;
  const pad = (v: number) => String(v).padStart(2, "0");
  return `${pad(time.hour)}:${pad(time.minute)}`;
}

function datesBetween(from: string, to: string): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function isWeekend(date: string): boolean {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}
