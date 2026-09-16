import { and, eq, gte, sql } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";
import { writeAudit } from "../audit.js";
import type { Db } from "../db/client.js";
import {
  auditLog,
  sessions,
  users,
  type UserRole,
  type UserRow,
} from "../db/schema/index.js";
import {
  checkPasswordStrength,
  hashPassword,
  verifyPassword,
} from "./password.js";
import {
  accountLockState,
  checkSessionValidity,
  lockUntilAfterFailure,
  lockoutWindowStart,
  LOCKOUT_THRESHOLD,
  sessionExpiryFrom,
} from "./policy.js";
import { generateToken, hashToken } from "./tokens.js";

/**
 * A precomputed Argon2id hash of a value nobody knows, verified against when
 * the email does not exist. Without it, a missing account returns in
 * microseconds while a real one takes ~50ms, and the difference enumerates
 * the school's user list.
 */
let decoyHash: string | null = null;
async function decoy(): Promise<string> {
  decoyHash ??= await hashPassword(generateToken());
  return decoyHash;
}

export interface AuthenticatedSession {
  sessionId: string;
  userId: string;
  role: UserRole;
  fullName: string;
  email: string;
  mustChangePassword: boolean;
}

export interface LoginRequest {
  email: string;
  password: string;
  ip: string | null;
  userAgent: string | null;
}

export type LoginResult =
  | {
      ok: true;
      sessionToken: string;
      csrfToken: string;
      expiresAt: Date;
      user: AuthenticatedSession;
    }
  | { ok: false; reason: "invalid_credentials" | "locked" };

export class AuthService {
  constructor(
    private readonly db: Db,
    private readonly log: FastifyBaseLogger,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * Verifies credentials and issues a session.
   *
   * Every failure path returns the same `invalid_credentials`, whatever
   * actually went wrong — unknown email, wrong password, deactivated
   * account — so nothing about the account list leaks. `locked` is separate
   * because telling someone their account is temporarily locked is useful
   * and is only reachable by someone already hammering that account.
   */
  async login(req: LoginRequest): Promise<LoginResult> {
    const now = this.now();
    const email = req.email.trim().toLowerCase();

    // Per-IP lockout, counted independently of the account (spec §9). The
    // source is the audit log, which is already required to record every
    // login failure with its IP, so no extra table is needed.
    if (
      req.ip &&
      (await this.ipFailureCount(req.ip, now)) >= LOCKOUT_THRESHOLD
    ) {
      await this.auditFailure(null, email, req, "ip_locked");
      return { ok: false, reason: "locked" };
    }

    const [user] = await this.db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (!user) {
      // Spend the same time as a real verification before answering.
      await verifyPassword(await decoy(), req.password);
      await this.auditFailure(null, email, req, "unknown_email");
      return { ok: false, reason: "invalid_credentials" };
    }

    const lock = accountLockState(user.lockedUntil, now);
    if (lock.locked) {
      await this.auditFailure(user.id, email, req, "account_locked");
      return { ok: false, reason: "locked" };
    }

    const passwordOk = await verifyPassword(user.passwordHash, req.password);

    if (!passwordOk || !user.isActive) {
      await this.auditFailure(
        user.id,
        email,
        req,
        passwordOk ? "inactive" : "bad_password",
      );
      // The attempt that trips the lock says so, rather than reporting a
      // bad password and leaving the user to discover the lock on their next
      // try with a different message.
      const nowLocked = await this.registerFailure(user, req, now);
      return {
        ok: false,
        reason: nowLocked ? "locked" : "invalid_credentials",
      };
    }

    const session = await this.issueSession(user, req, now);

    await this.db
      .update(users)
      .set({
        failedAttempts: 0,
        lockedUntil: null,
        lastLoginAt: now,
        updatedAt: now,
      })
      .where(eq(users.id, user.id));

    await writeAudit(this.db, this.log, {
      action: "login_success",
      userId: user.id,
      entity: "session",
      entityId: session.user.sessionId,
      ip: req.ip,
      userAgent: req.userAgent,
      createdAt: now,
    });

    return session;
  }

  /** Resolves a session cookie to its user, and touches `last_seen_at`. */
  async resolveSession(
    sessionToken: string,
  ): Promise<{ session: AuthenticatedSession; csrfHash: string } | null> {
    const now = this.now();
    const tokenHash = hashToken(sessionToken);

    const [row] = await this.db
      .select({
        sessionId: sessions.id,
        csrfHash: sessions.csrfHash,
        issuedAt: sessions.issuedAt,
        expiresAt: sessions.expiresAt,
        lastSeenAt: sessions.lastSeenAt,
        revokedAt: sessions.revokedAt,
        userId: users.id,
        role: users.role,
        fullName: users.fullName,
        email: users.email,
        isActive: users.isActive,
        mustChangePassword: users.mustChangePassword,
      })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(eq(sessions.tokenHash, tokenHash))
      .limit(1);

    if (!row) return null;

    const validity = checkSessionValidity(row, now);
    if (!validity.valid) {
      // Tidy up so an expired row cannot be resurrected by a clock change.
      if (row.revokedAt === null) {
        await this.db
          .update(sessions)
          .set({ revokedAt: now })
          .where(eq(sessions.id, row.sessionId));
      }
      return null;
    }
    // A user deactivated mid-session loses access immediately.
    if (!row.isActive) {
      await this.db
        .update(sessions)
        .set({ revokedAt: now })
        .where(eq(sessions.id, row.sessionId));
      return null;
    }

    await this.db
      .update(sessions)
      .set({ lastSeenAt: now })
      .where(eq(sessions.id, row.sessionId));

    return {
      csrfHash: row.csrfHash,
      session: {
        sessionId: row.sessionId,
        userId: row.userId,
        role: row.role,
        fullName: row.fullName,
        email: row.email,
        mustChangePassword: row.mustChangePassword,
      },
    };
  }

  async logout(
    sessionId: string,
    userId: string,
    ip: string | null,
    ua: string | null,
  ): Promise<void> {
    await this.db
      .update(sessions)
      .set({ revokedAt: this.now() })
      .where(eq(sessions.id, sessionId));
    await writeAudit(this.db, this.log, {
      action: "logout",
      userId,
      entity: "session",
      entityId: sessionId,
      ip,
      userAgent: ua,
    });
  }

  /**
   * Changes a password and invalidates every session for that user,
   * including the one making the request: a password change is exactly when
   * you want any session the attacker holds to stop working.
   */
  async changePassword(args: {
    userId: string;
    currentPassword: string;
    newPassword: string;
    ip: string | null;
    userAgent: string | null;
  }): Promise<
    | { ok: true }
    | { ok: false; reason: "invalid_credentials" | "weak"; problems?: string[] }
  > {
    const now = this.now();
    const [user] = await this.db
      .select()
      .from(users)
      .where(eq(users.id, args.userId))
      .limit(1);
    if (!user) return { ok: false, reason: "invalid_credentials" };

    if (!(await verifyPassword(user.passwordHash, args.currentPassword))) {
      await writeAudit(this.db, this.log, {
        action: "login_failure",
        userId: user.id,
        entity: "password_change",
        ip: args.ip,
        userAgent: args.userAgent,
        after: { outcome: "wrong_current_password" },
      });
      return { ok: false, reason: "invalid_credentials" };
    }

    const strength = checkPasswordStrength(args.newPassword, {
      personal: [user.email, user.fullName],
    });
    if (!strength.ok)
      return { ok: false, reason: "weak", problems: strength.problems };

    if (await verifyPassword(user.passwordHash, args.newPassword)) {
      return {
        ok: false,
        reason: "weak",
        problems: ["The new password must differ from the current one."],
      };
    }

    await this.db
      .update(users)
      .set({
        passwordHash: await hashPassword(args.newPassword),
        mustChangePassword: false,
        updatedAt: now,
      })
      .where(eq(users.id, user.id));

    await this.db
      .update(sessions)
      .set({ revokedAt: now })
      .where(
        and(eq(sessions.userId, user.id), sql`${sessions.revokedAt} is null`),
      );

    await writeAudit(this.db, this.log, {
      action: "password_change",
      userId: user.id,
      entity: "user",
      entityId: user.id,
      ip: args.ip,
      userAgent: args.userAgent,
    });

    return { ok: true };
  }

  // ── internals ───────────────────────────────────────────────────────────

  private async issueSession(
    user: UserRow,
    req: LoginRequest,
    now: Date,
  ): Promise<Extract<LoginResult, { ok: true }>> {
    const sessionToken = generateToken();
    const csrfToken = generateToken();
    const expiresAt = sessionExpiryFrom(now);

    const [row] = await this.db
      .insert(sessions)
      .values({
        userId: user.id,
        tokenHash: hashToken(sessionToken),
        csrfHash: hashToken(csrfToken),
        issuedAt: now,
        expiresAt,
        lastSeenAt: now,
        ip: req.ip && isInet(req.ip) ? req.ip : null,
        userAgent: req.userAgent?.slice(0, 500) ?? null,
      })
      .returning({ id: sessions.id });

    return {
      ok: true,
      sessionToken,
      csrfToken,
      expiresAt,
      user: {
        sessionId: row!.id,
        userId: user.id,
        role: user.role,
        fullName: user.fullName,
        email: user.email,
        mustChangePassword: user.mustChangePassword,
      },
    };
  }

  /**
   * Called after the failure has been audited, so the audit log is the single
   * source of truth for "how many failures inside the window" — both here and
   * for the per-IP rule. `failed_attempts` is still maintained, because the
   * specification's schema has it and an administrator will want to see it,
   * but no locking decision depends on that column being accurate.
   */
  private async registerFailure(
    user: UserRow,
    req: LoginRequest,
    now: Date,
  ): Promise<boolean> {
    const total = await this.accountFailureCount(user.id, now);
    const lockedUntil = lockUntilAfterFailure(total, now);

    await this.db
      .update(users)
      .set({
        failedAttempts: total,
        lockedUntil: lockedUntil ?? user.lockedUntil,
        updatedAt: now,
      })
      .where(eq(users.id, user.id));

    if (lockedUntil) {
      await writeAudit(this.db, this.log, {
        action: "lockout",
        userId: user.id,
        entity: "user",
        entityId: user.id,
        ip: req.ip,
        userAgent: req.userAgent,
        createdAt: now,
        after: { lockedUntil: lockedUntil.toISOString(), failures: total },
      });
    }
    return lockedUntil !== null;
  }

  /** Failed logins against this account inside the lockout window. */
  private async accountFailureCount(
    userId: string,
    now: Date,
  ): Promise<number> {
    const [row] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.action, "login_failure"),
          eq(auditLog.userId, userId),
          gte(auditLog.createdAt, lockoutWindowStart(now)),
        ),
      );
    return row?.n ?? 0;
  }

  /** Failed logins from this IP inside the lockout window, across all accounts. */
  private async ipFailureCount(ip: string, now: Date): Promise<number> {
    if (!isInet(ip)) return 0;
    const [row] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.action, "login_failure"),
          eq(auditLog.ip, ip),
          gte(auditLog.createdAt, lockoutWindowStart(now)),
        ),
      );
    return row?.n ?? 0;
  }

  private async auditFailure(
    userId: string | null,
    email: string,
    req: LoginRequest,
    outcome: string,
  ): Promise<void> {
    await writeAudit(this.db, this.log, {
      action: "login_failure",
      userId,
      entity: "user",
      // The address is the subject of the event; it is not written to the
      // application log, only here.
      entityId: userId ?? null,
      ip: req.ip,
      userAgent: req.userAgent,
      createdAt: this.now(),
      after: {
        outcome,
        emailAttempted: userId ? undefined : redactEmail(email),
      },
    });
  }
}

function isInet(v: string): boolean {
  return /^[0-9.]+$/.test(v) || v.includes(":");
}

/** Enough to investigate a pattern of attempts, not enough to harvest addresses. */
function redactEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  const head = local.slice(0, 2);
  return `${head}${"*".repeat(Math.max(0, local.length - 2))}@${domain}`;
}
