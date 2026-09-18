import { isIP } from "node:net";
import type { FastifyBaseLogger } from "fastify";
import type { Db } from "./db/client.js";
import { auditLog } from "./db/schema/index.js";

/**
 * The append-only record of everything that matters (specification §9). The
 * database refuses UPDATE and DELETE on this table, so an entry written here
 * is permanent.
 */
export const AUDIT_ACTIONS = [
  "login_success",
  "login_failure",
  "logout",
  "lockout",
  "password_change",
  "user_created",
  "user_modified",
  "user_deactivated",
  "person_created",
  "person_modified",
  "person_deactivated",
  "csv_import",
  "manual_adjustment",
  "device_configured",
  "group_created",
  "group_modified",
  "attendance_rule_changed",
  "report_export",
  "audit_export",
  "dead_letter_replay",
  "dead_letter_dismissed",
  "dead_letter_restored",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export interface AuditEntry {
  action: AuditAction;
  userId?: string | null;
  entity?: string | null;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
  userAgent?: string | null;
  /**
   * When the event happened, per the application's clock. Passing it keeps
   * audit timestamps consistent with the logic that reads them back — the
   * lockout window, for instance. Omitted, the database default applies.
   */
  createdAt?: Date;
}

/**
 * Writes one entry. Failure is logged but never propagated: an audit write
 * that throws must not turn a successful login into a 500. The log line is
 * the backstop if the table is ever unwritable.
 */
export async function writeAudit(
  db: Db,
  log: FastifyBaseLogger,
  entry: AuditEntry,
): Promise<void> {
  try {
    await db.insert(auditLog).values({
      action: entry.action,
      userId: entry.userId ?? null,
      entity: entry.entity ?? null,
      entityId: entry.entityId ?? null,
      before: entry.before ?? null,
      after: entry.after ?? null,
      // inet rejects anything that is not an address; a proxy can present
      // junk, and that must not break the request being audited.
      ip: entry.ip && isIP(entry.ip) ? entry.ip : null,
      userAgent: entry.userAgent?.slice(0, 500) ?? null,
      ...(entry.createdAt ? { createdAt: entry.createdAt } : {}),
    });
  } catch (err) {
    log.error(
      {
        action: entry.action,
        err: err instanceof Error ? err.message : String(err),
      },
      "audit write failed",
    );
  }
}
