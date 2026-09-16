import { describe, expect, it } from "vitest";
import {
  accountLockState,
  checkSessionValidity,
  lockUntilAfterFailure,
  LOCKOUT_DURATION_MS,
  LOCKOUT_THRESHOLD,
  LOCKOUT_WINDOW_MS,
  SESSION_ABSOLUTE_MS,
  SESSION_IDLE_MS,
  sessionExpiryFrom,
} from "../src/auth/policy.js";
import {
  constantTimeEquals,
  generateToken,
  hashToken,
} from "../src/auth/tokens.js";

const T0 = new Date("2026-09-17T08:00:00.000Z");
const at = (ms: number) => new Date(T0.getTime() + ms);
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

describe("session validity", () => {
  const fresh = {
    issuedAt: T0,
    expiresAt: sessionExpiryFrom(T0),
    lastSeenAt: T0,
    revokedAt: null,
  };

  it("accepts a session in use", () => {
    expect(checkSessionValidity(fresh, at(HOUR))).toEqual({ valid: true });
  });

  it("expires 12 hours after issue even if in constant use", () => {
    const busy = { ...fresh, lastSeenAt: at(SESSION_ABSOLUTE_MS - MINUTE) };
    expect(checkSessionValidity(busy, at(SESSION_ABSOLUTE_MS))).toEqual({
      valid: false,
      reason: "expired_absolute",
    });
  });

  it("expires after 8 hours of inactivity even though the absolute limit has not passed", () => {
    expect(checkSessionValidity(fresh, at(SESSION_IDLE_MS))).toEqual({
      valid: false,
      reason: "expired_idle",
    });
    // 8h is inside the 12h absolute window, so idle is what caught it.
    expect(SESSION_IDLE_MS).toBeLessThan(SESSION_ABSOLUTE_MS);
  });

  it("stays valid just before the idle limit", () => {
    expect(checkSessionValidity(fresh, at(SESSION_IDLE_MS - 1000)).valid).toBe(
      true,
    );
  });

  it("rejects a revoked session regardless of times", () => {
    expect(
      checkSessionValidity({ ...fresh, revokedAt: T0 }, at(MINUTE)),
    ).toEqual({
      valid: false,
      reason: "revoked",
    });
  });

  it("puts absolute expiry 12 hours after issue", () => {
    expect(sessionExpiryFrom(T0).getTime() - T0.getTime()).toBe(12 * HOUR);
  });
});

describe("account lockout", () => {
  it("is not locked when locked_until is null or past", () => {
    expect(accountLockState(null, T0).locked).toBe(false);
    expect(accountLockState(at(-MINUTE), T0).locked).toBe(false);
  });

  it("is locked while locked_until is in the future", () => {
    const state = accountLockState(at(MINUTE), T0);
    expect(state.locked).toBe(true);
    expect(state.until).toEqual(at(MINUTE));
  });

  it("locks on the fifth failure, not the fourth", () => {
    expect(lockUntilAfterFailure(LOCKOUT_THRESHOLD - 1, T0)).toBeNull();
    const until = lockUntilAfterFailure(LOCKOUT_THRESHOLD, T0);
    expect(until).not.toBeNull();
    expect(until!.getTime() - T0.getTime()).toBe(LOCKOUT_DURATION_MS);
  });

  it("locks for 15 minutes", () => {
    expect(LOCKOUT_DURATION_MS).toBe(15 * MINUTE);
    expect(LOCKOUT_WINDOW_MS).toBe(15 * MINUTE);
  });

});

describe("tokens", () => {
  it("generates distinct, URL-safe, high-entropy tokens", () => {
    const a = generateToken();
    const b = generateToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    // 32 random bytes in base64url.
    expect(a.length).toBeGreaterThanOrEqual(43);
  });

  it("hashes deterministically and irreversibly", () => {
    const token = generateToken();
    expect(hashToken(token)).toBe(hashToken(token));
    expect(hashToken(token)).not.toContain(token);
    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("compares in constant time, including length mismatches", () => {
    const a = generateToken();
    expect(constantTimeEquals(a, a)).toBe(true);
    expect(constantTimeEquals(a, generateToken())).toBe(false);
    expect(constantTimeEquals(a, a.slice(0, -1))).toBe(false);
    expect(constantTimeEquals("", "")).toBe(true);
  });
});
