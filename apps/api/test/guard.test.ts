import { describe, expect, it } from "vitest";
import { isAllowed, parseAllowlist, RateLimiter } from "../src/ingest/guard.js";

describe("parseAllowlist", () => {
  it("parses addresses and CIDR blocks", () => {
    const { rules, problems } = parseAllowlist(
      "203.0.113.7, 198.51.100.0/24, 2001:db8::/32",
    );
    expect(problems).toEqual([]);
    expect(rules).toHaveLength(3);
    expect(rules[0]).toMatchObject({ prefixBits: 32, family: 4 });
    expect(rules[1]).toMatchObject({ prefixBits: 24, family: 4 });
    expect(rules[2]).toMatchObject({ prefixBits: 32, family: 6 });
  });

  it("ignores blank entries and surrounding space", () => {
    expect(parseAllowlist("  203.0.113.7 , , ").rules).toHaveLength(1);
  });

  it("reports a typo rather than silently matching nothing", () => {
    // An allowlist that quietly matches nothing would lock the school's own
    // reader out of its own system.
    const { rules, problems } = parseAllowlist(
      "203.0.113.7, not-an-ip, 10.0.0.0/64",
    );
    expect(rules).toHaveLength(1);
    expect(problems).toHaveLength(2);
    expect(problems[0]).toMatch(/not an IP address/);
    expect(problems[1]).toMatch(/prefix length/);
  });

  it("returns nothing for an empty setting", () => {
    expect(parseAllowlist("").rules).toEqual([]);
  });
});

describe("isAllowed", () => {
  const rules = parseAllowlist(
    "203.0.113.7, 198.51.100.0/24, 2001:db8:abcd::/48",
  ).rules;

  it("allows everything when no allowlist is configured", () => {
    // The honest default: refusing everything would mean collecting nothing.
    expect(isAllowed("203.0.113.7", [])).toBe(true);
    expect(isAllowed("anything", [])).toBe(true);
  });

  it("allows an exact address", () => {
    expect(isAllowed("203.0.113.7", rules)).toBe(true);
    expect(isAllowed("203.0.113.8", rules)).toBe(false);
  });

  it("allows an address inside a CIDR block and refuses one outside", () => {
    expect(isAllowed("198.51.100.1", rules)).toBe(true);
    expect(isAllowed("198.51.100.255", rules)).toBe(true);
    expect(isAllowed("198.51.101.1", rules)).toBe(false);
  });

  it("matches an IPv4 address arriving in its IPv6-mapped form", () => {
    // Node presents a v4 client on a dual-stack socket this way; without
    // this the school's own reader would be refused.
    expect(isAllowed("::ffff:203.0.113.7", rules)).toBe(true);
    expect(isAllowed("::ffff:203.0.113.8", rules)).toBe(false);
  });

  it("matches IPv6 prefixes", () => {
    expect(isAllowed("2001:db8:abcd::1", rules)).toBe(true);
    expect(isAllowed("2001:db8:abcd:1234::1", rules)).toBe(true);
    expect(isAllowed("2001:db8:abce::1", rules)).toBe(false);
  });

  it("does not let a v6 address match a v4 rule or the reverse", () => {
    expect(
      isAllowed("2001:db8:abcd::1", parseAllowlist("198.51.100.0/24").rules),
    ).toBe(false);
    expect(
      isAllowed("198.51.100.1", parseAllowlist("2001:db8::/32").rules),
    ).toBe(false);
  });

  it("refuses something that is not an address at all", () => {
    expect(isAllowed("", rules)).toBe(false);
    expect(isAllowed("localhost", rules)).toBe(false);
  });

  it("treats /0 as allowing that whole family", () => {
    const any = parseAllowlist("0.0.0.0/0").rules;
    expect(isAllowed("1.2.3.4", any)).toBe(true);
    expect(isAllowed("203.0.113.7", any)).toBe(true);
  });
});

describe("RateLimiter", () => {
  it("allows requests up to the limit and refuses the next", () => {
    let now = 0;
    const limiter = new RateLimiter(3, 60_000, () => now);
    expect(limiter.check("a")).toBe(true);
    expect(limiter.check("a")).toBe(true);
    expect(limiter.check("a")).toBe(true);
    expect(limiter.check("a")).toBe(false);
  });

  it("counts each address separately", () => {
    let now = 0;
    const limiter = new RateLimiter(1, 60_000, () => now);
    expect(limiter.check("a")).toBe(true);
    expect(limiter.check("b")).toBe(true);
    expect(limiter.check("a")).toBe(false);
  });

  it("starts a fresh window once the old one passes", () => {
    let now = 0;
    const limiter = new RateLimiter(1, 60_000, () => now);
    expect(limiter.check("a")).toBe(true);
    expect(limiter.check("a")).toBe(false);
    now = 60_000;
    expect(limiter.check("a")).toBe(true);
  });

  it("is disabled by a limit of zero", () => {
    const limiter = new RateLimiter(0);
    for (let i = 0; i < 10_000; i++) expect(limiter.check("a")).toBe(true);
  });

  it("does not grow without bound", () => {
    let now = 0;
    const limiter = new RateLimiter(1, 1000, () => now);
    for (let i = 0; i < 2000; i++) limiter.check(`ip-${i}`);
    now = 10_000;
    // The sweep runs on the next new window; nothing here should throw or
    // retain every key seen.
    expect(limiter.check("fresh")).toBe(true);
  });
});
