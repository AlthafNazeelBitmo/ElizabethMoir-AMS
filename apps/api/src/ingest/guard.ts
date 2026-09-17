import { isIP } from "node:net";

/**
 * Who is allowed to post scans, and how often.
 *
 * The webhook carries no credentials of any kind, so the defences are the
 * secret path segment, an address allowlist, and a rate limit. All three
 * are checked before the body is read: an unwelcome caller should not be
 * able to make the server do work, and should not learn that the endpoint
 * exists.
 */

// ── Address allowlist ─────────────────────────────────────────────────────

export interface AllowRule {
  /** The network address, as parsed. */
  bytes: Uint8Array;
  /** How many leading bits must match. */
  prefixBits: number;
  family: 4 | 6;
  source: string;
}

/**
 * Parses a comma-separated list of addresses and CIDR blocks.
 *
 * Anything unparseable is reported rather than ignored: an allowlist with
 * a typo in it that silently matches nothing would lock the school's own
 * reader out of its own system.
 */
export function parseAllowlist(raw: string): {
  rules: AllowRule[];
  problems: string[];
} {
  const rules: AllowRule[] = [];
  const problems: string[] = [];

  for (const entry of raw
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean)) {
    const [address, prefix] = entry.split("/");
    const family = isIP(address ?? "");
    if (family === 0) {
      problems.push(`"${entry}" is not an IP address or CIDR block.`);
      continue;
    }
    const bytes = toBytes(address!, family as 4 | 6);
    if (bytes === null) {
      problems.push(`"${entry}" could not be parsed.`);
      continue;
    }
    const maxBits = family === 4 ? 32 : 128;
    const prefixBits = prefix === undefined ? maxBits : Number(prefix);
    if (
      !Number.isInteger(prefixBits) ||
      prefixBits < 0 ||
      prefixBits > maxBits
    ) {
      problems.push(`"${entry}" has a prefix length outside 0-${maxBits}.`);
      continue;
    }
    rules.push({ bytes, prefixBits, family: family as 4 | 6, source: entry });
  }

  return { rules, problems };
}

export function isAllowed(ip: string, rules: readonly AllowRule[]): boolean {
  // An empty allowlist allows everything. That is the honest default until
  // the discovery run says which addresses the platform posts from —
  // refusing everything would simply mean collecting no data at all.
  if (rules.length === 0) return true;

  const family = isIP(ip);
  if (family === 0) return false;

  // A v4 address arriving as ::ffff:1.2.3.4 must still match a v4 rule.
  const normalised =
    ip.startsWith("::ffff:") && isIP(ip.slice(7)) === 4 ? ip.slice(7) : ip;
  const actualFamily = isIP(normalised) as 4 | 6;
  const bytes = toBytes(normalised, actualFamily);
  if (bytes === null) return false;

  return rules.some(
    (rule) => rule.family === actualFamily && matches(bytes, rule),
  );
}

function matches(address: Uint8Array, rule: AllowRule): boolean {
  let bitsLeft = rule.prefixBits;
  for (let i = 0; i < address.length && bitsLeft > 0; i++) {
    const take = Math.min(8, bitsLeft);
    const mask = take === 8 ? 0xff : (0xff << (8 - take)) & 0xff;
    if ((address[i]! & mask) !== (rule.bytes[i]! & mask)) return false;
    bitsLeft -= take;
  }
  return true;
}

function toBytes(address: string, family: 4 | 6): Uint8Array | null {
  if (family === 4) {
    const parts = address.split(".").map(Number);
    if (
      parts.length !== 4 ||
      parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)
    ) {
      return null;
    }
    return Uint8Array.from(parts);
  }

  // IPv6, including the :: compression and a trailing v4 form.
  let text = address;
  let tail: number[] = [];
  const lastColon = text.lastIndexOf(":");
  const maybeV4 = text.slice(lastColon + 1);
  if (maybeV4.includes(".")) {
    const v4 = toBytes(maybeV4, 4);
    if (v4 === null) return null;
    tail = [...v4];
    text = text.slice(0, lastColon + 1) + "0:0";
  }

  const [head, rest] = text.split("::");
  const headGroups = head === "" ? [] : head!.split(":").filter(Boolean);
  const tailGroups =
    rest === undefined
      ? []
      : rest === ""
        ? []
        : rest.split(":").filter(Boolean);
  const totalGroups = 8 - (tail.length > 0 ? 1 : 0);
  const missing = totalGroups - headGroups.length - tailGroups.length;
  if (rest === undefined && missing !== 0) return null;
  if (missing < 0) return null;

  const groups = [
    ...headGroups,
    ...Array<string>(missing).fill("0"),
    ...tailGroups,
  ];
  const bytes: number[] = [];
  for (const group of groups) {
    const value = Number.parseInt(group, 16);
    if (!Number.isInteger(value) || value < 0 || value > 0xffff) return null;
    bytes.push((value >> 8) & 0xff, value & 0xff);
  }
  bytes.push(...tail);
  return bytes.length === 16 ? Uint8Array.from(bytes) : null;
}

// ── Rate limit ────────────────────────────────────────────────────────────

/**
 * A fixed-window counter per address.
 *
 * In memory, and therefore per process: on a serverless host each instance
 * counts separately, which weakens it. That is acceptable because this is
 * the third line of defence, not the first — the secret path and the
 * allowlist are what actually keep strangers out. Its job is to stop one
 * misbehaving client from exhausting the database.
 *
 * The limit must be generous. The upstream platform never retries, so a
 * scan refused here is a scan lost forever; the default is far above
 * anything a school's readers could produce.
 */
export class RateLimiter {
  private readonly windows = new Map<
    string,
    { count: number; resetAt: number }
  >();

  constructor(
    private readonly limit: number,
    private readonly windowMs = 60_000,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** Returns true when the request is within the limit. */
  check(key: string): boolean {
    if (this.limit <= 0) return true; // disabled
    const now = this.now();
    const existing = this.windows.get(key);

    if (existing === undefined || now >= existing.resetAt) {
      this.windows.set(key, { count: 1, resetAt: now + this.windowMs });
      this.sweep(now);
      return true;
    }
    existing.count += 1;
    return existing.count <= this.limit;
  }

  /** Drops expired windows so a long-running process does not grow forever. */
  private sweep(now: number): void {
    if (this.windows.size < 1000) return;
    for (const [key, window] of this.windows) {
      if (now >= window.resetAt) this.windows.delete(key);
    }
  }
}
