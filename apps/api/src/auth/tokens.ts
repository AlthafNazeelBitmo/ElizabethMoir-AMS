import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Session and CSRF tokens.
 *
 * The raw token goes to the browser; only its SHA-256 is stored. A database
 * leak therefore yields no usable cookies. SHA-256 rather than Argon2 is
 * correct here: the token is 256 bits of randomness, not a guessable
 * secret, so there is nothing for a slow hash to defend against — and a slow
 * hash on every authenticated request would be a self-inflicted DoS.
 */

/** 32 bytes of randomness, URL-safe. */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Compares two strings without leaking their common prefix length. */
export function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
