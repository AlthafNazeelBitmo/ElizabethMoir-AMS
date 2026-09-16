import { describe, expect, it } from "vitest";
import {
  checkPasswordStrength,
  hashPassword,
  MIN_PASSWORD_LENGTH,
  verifyPassword,
} from "../src/auth/password.js";

describe("hashPassword / verifyPassword", () => {
  it("round-trips a password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(await verifyPassword(hash, "correct horse battery staple")).toBe(
      true,
    );
    expect(await verifyPassword(hash, "correct horse battery stapler")).toBe(
      false,
    );
  }, 20_000);

  it("uses Argon2id with at least 19 MiB of memory", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(hash.startsWith("$argon2id$")).toBe(true);
    const memory = /m=(\d+)/.exec(hash)?.[1];
    expect(Number(memory)).toBeGreaterThanOrEqual(19 * 1024);
  }, 20_000);

  it("salts, so the same password hashes differently each time", async () => {
    const [a, b] = await Promise.all([
      hashPassword("a long enough password"),
      hashPassword("a long enough password"),
    ]);
    expect(a).not.toBe(b);
  }, 20_000);

  it("treats a malformed stored hash as a failed verification, not an error", async () => {
    await expect(verifyPassword("not-a-hash", "anything")).resolves.toBe(false);
    await expect(verifyPassword("", "anything")).resolves.toBe(false);
  });
});

describe("checkPasswordStrength", () => {
  it("accepts a long, unremarkable passphrase", () => {
    expect(checkPasswordStrength("brass lantern quiet morning").ok).toBe(true);
  });

  it(`requires at least ${MIN_PASSWORD_LENGTH} characters`, () => {
    const r = checkPasswordStrength("Sh0rt!aA");
    expect(r.ok).toBe(false);
    expect(r.problems.join(" ")).toMatch(/at least 12/);
  });

  it("imposes no composition rules: all-lowercase letters are fine if long", () => {
    // The specification forbids composition rules, and this is the test that
    // keeps someone from reintroducing them.
    expect(checkPasswordStrength("thequickbrownfoxjumped").ok).toBe(true);
  });

  it("rejects common passwords regardless of length", () => {
    expect(checkPasswordStrength("password123").ok).toBe(false);
    expect(checkPasswordStrength("Password123").ok).toBe(false); // case-insensitive
    expect(checkPasswordStrength("attendance").ok).toBe(false);
  });

  it("rejects a repeated short unit", () => {
    expect(checkPasswordStrength("abcabcabcabcabc").ok).toBe(false);
    expect(checkPasswordStrength("aaaaaaaaaaaaaaa").ok).toBe(false);
  });

  it("rejects keyboard and number runs", () => {
    expect(checkPasswordStrength("abcdefghijklmn").ok).toBe(false);
    expect(checkPasswordStrength("qwertyuiop").ok).toBe(false);
    expect(checkPasswordStrength("0123456789").ok).toBe(false);
  });

  it("rejects a password containing the user's own details", () => {
    const ctx = { personal: ["rashmi.perera@school.lk", "Rashmi Perera"] };
    expect(checkPasswordStrength("rashmi-loves-cats-99", ctx).ok).toBe(false);
    expect(checkPasswordStrength("perera-is-here-today", ctx).ok).toBe(false);
    // An unrelated long passphrase is unaffected.
    expect(checkPasswordStrength("brass lantern quiet morning", ctx).ok).toBe(
      true,
    );
  });

  it("ignores short personal tokens that would match almost anything", () => {
    // "A" and "Li" must not cause every password containing them to fail.
    expect(
      checkPasswordStrength("brass lantern quiet morning", {
        personal: ["A Li"],
      }).ok,
    ).toBe(true);
  });

  it("rejects whitespace-only input", () => {
    expect(checkPasswordStrength("                ").ok).toBe(false);
  });

  it("returns every distinct problem, not just the first", () => {
    const r = checkPasswordStrength("abc");
    expect(r.problems.length).toBeGreaterThan(0);
    expect(new Set(r.problems).size).toBe(r.problems.length);
  });
});
