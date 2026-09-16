/**
 * Authentication timings and thresholds, from specification §9. Pure values
 * and pure functions over them, so the rules can be tested without a clock,
 * a database, or a request.
 */

export const SESSION_IDLE_MS = 8 * 60 * 60 * 1000; // 8 hours
export const SESSION_ABSOLUTE_MS = 12 * 60 * 60 * 1000; // 12 hours

export const LOCKOUT_THRESHOLD = 5;
export const LOCKOUT_WINDOW_MS = 15 * 60 * 1000; // 5 failures within 15 minutes
export const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // locks for 15 minutes

export interface SessionTimes {
  issuedAt: Date;
  expiresAt: Date;
  lastSeenAt: Date;
  revokedAt: Date | null;
}

export type SessionValidity =
  | { valid: true }
  | { valid: false; reason: "revoked" | "expired_absolute" | "expired_idle" };

/**
 * A session dies at whichever comes first: 12 hours after issue, or 8 hours
 * without use. Both are checked here rather than relying on `expires_at`
 * alone, so a stale row can never be honoured.
 */
export function checkSessionValidity(
  s: SessionTimes,
  now: Date,
): SessionValidity {
  if (s.revokedAt !== null) return { valid: false, reason: "revoked" };
  if (now >= s.expiresAt) return { valid: false, reason: "expired_absolute" };
  if (now.getTime() - s.lastSeenAt.getTime() >= SESSION_IDLE_MS) {
    return { valid: false, reason: "expired_idle" };
  }
  return { valid: true };
}

export function sessionExpiryFrom(issuedAt: Date): Date {
  return new Date(issuedAt.getTime() + SESSION_ABSOLUTE_MS);
}

export interface LockState {
  locked: boolean;
  /** When the lock lifts. Null when not locked. */
  until: Date | null;
}

/** An account is locked while `locked_until` is in the future. */
export function accountLockState(
  lockedUntil: Date | null,
  now: Date,
): LockState {
  if (lockedUntil !== null && lockedUntil > now)
    return { locked: true, until: lockedUntil };
  return { locked: false, until: null };
}

/**
 * Whether this failure trips the lock, given how many failures already sit
 * inside the window. Returns the new `locked_until`, or null to leave it be.
 */
export function lockUntilAfterFailure(
  failuresInWindowIncludingThisOne: number,
  now: Date,
): Date | null {
  if (failuresInWindowIncludingThisOne < LOCKOUT_THRESHOLD) return null;
  return new Date(now.getTime() + LOCKOUT_DURATION_MS);
}

/** The start of the window failures are counted within. */
export function lockoutWindowStart(now: Date): Date {
  return new Date(now.getTime() - LOCKOUT_WINDOW_MS);
}

