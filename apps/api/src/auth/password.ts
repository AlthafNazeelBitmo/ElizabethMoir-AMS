import { hash, verify } from "@node-rs/argon2";
import { COMMON_PASSWORDS } from "./common-passwords.js";

/**
 * Argon2id at the OWASP-recommended floor: 19 MiB of memory, two passes,
 * one lane. The specification requires memory cost >= 19 MiB; these are the
 * parameters that go with it.
 */
/**
 * The library exports `Algorithm` as an ambient const enum, which cannot be
 * imported under `verbatimModuleSyntax`. 2 is Argon2id; 0 and 1 are Argon2d
 * and Argon2i, which are not what we want.
 */
const ARGON2ID = 2;

const ARGON2_OPTIONS = {
  algorithm: ARGON2ID,
  memoryCost: 19_456, // KiB = 19 MiB
  timeCost: 2,
  parallelism: 1,
} as const;

export const MIN_PASSWORD_LENGTH = 12;
/** Argon2 handles long inputs, but an unbounded one is a cheap DoS. */
export const MAX_PASSWORD_LENGTH = 1024;

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, ARGON2_OPTIONS);
}

/** Never throws: a malformed stored hash is a failed verification, not a crash. */
export async function verifyPassword(
  storedHash: string,
  plain: string,
): Promise<boolean> {
  try {
    return await verify(storedHash, plain, ARGON2_OPTIONS);
  } catch {
    return false;
  }
}

export interface PasswordCheck {
  ok: boolean;
  /** Reasons to show the user. Empty when ok. */
  problems: string[];
}

export interface PasswordContext {
  /** Rejected as a component of the password: email, name, school name. */
  personal?: (string | null | undefined)[];
}

/**
 * Length and a blocklist, deliberately nothing else.
 *
 * The specification forbids composition rules ("must contain a digit and a
 * symbol") and it is right to: they push people towards Passw0rd! and are
 * weaker than length. What is checked instead is that the password is long,
 * is not one of the passwords attackers try first, and does not contain
 * something guessable about this particular user.
 */
export function checkPasswordStrength(
  plain: string,
  ctx: PasswordContext = {},
): PasswordCheck {
  const problems: string[] = [];

  if (plain.length < MIN_PASSWORD_LENGTH) {
    problems.push(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  if (plain.length > MAX_PASSWORD_LENGTH) {
    problems.push(`Use at most ${MAX_PASSWORD_LENGTH} characters.`);
  }
  if (plain.trim().length === 0) {
    problems.push("A password cannot be only spaces.");
  }

  const normalised = plain.toLowerCase().trim();
  if (COMMON_PASSWORDS.has(normalised)) {
    problems.push(
      "This password is one of the most commonly used ones. Choose something else.",
    );
  }
  if (isRepetitive(normalised)) {
    problems.push(
      "This password repeats a short pattern. Choose something less predictable.",
    );
  }
  if (isSequential(normalised)) {
    problems.push(
      "This password is a keyboard or number sequence. Choose something else.",
    );
  }

  for (const raw of ctx.personal ?? []) {
    const piece = raw?.toLowerCase().trim();
    if (!piece) continue;
    for (const token of piece.split(/[\s@._-]+/).filter((t) => t.length >= 4)) {
      if (normalised.includes(token)) {
        problems.push(
          "Do not include your name, email address, or the school's name.",
        );
        return { ok: false, problems: [...new Set(problems)] };
      }
    }
  }

  return { ok: problems.length === 0, problems: [...new Set(problems)] };
}

/** "abcabcabcabc" or "aaaaaaaaaaaa": a short unit repeated to reach length. */
function isRepetitive(s: string): boolean {
  if (s.length < 6) return false;
  for (let unit = 1; unit <= Math.floor(s.length / 3); unit++) {
    const head = s.slice(0, unit);
    if (head.repeat(Math.ceil(s.length / unit)).slice(0, s.length) === s)
      return true;
  }
  return false;
}

/** Runs along a keyboard row or the digits, forwards or backwards. */
function isSequential(s: string): boolean {
  if (s.length < 6) return false;
  const rows = [
    "abcdefghijklmnopqrstuvwxyz",
    "0123456789",
    "qwertyuiop",
    "asdfghjkl",
    "zxcvbnm",
  ];
  const reversed = [...s].reverse().join("");
  return rows.some((row) => row.includes(s) || row.includes(reversed));
}
