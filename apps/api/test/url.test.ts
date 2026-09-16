import { describe, expect, it } from "vitest";
import {
  databaseUrlCandidates,
  looksPooled,
  resolveDatabaseUrl,
} from "../src/db/url.js";

const NEON_POOLED =
  "postgres://u:p@ep-x-123-pooler.us-east-2.aws.neon.tech/db?sslmode=require";
const NEON_DIRECT =
  "postgres://u:p@ep-x-123.us-east-2.aws.neon.tech/db?sslmode=require";
const SUPABASE_POOLED =
  "postgres://u:p@aws-0-eu-west-1.pooler.supabase.com:6543/postgres";
const SUPABASE_DIRECT = "postgres://u:p@db.abcdef.supabase.co:5432/postgres";

describe("resolveDatabaseUrl", () => {
  it("returns null when nothing is set", () => {
    expect(resolveDatabaseUrl({})).toBeNull();
    expect(resolveDatabaseUrl({ DATABASE_URL: "" })).toBeNull();
    expect(resolveDatabaseUrl({ DATABASE_URL: "   " })).toBeNull();
  });

  it("prefers DATABASE_URL above every alternative", () => {
    const r = resolveDatabaseUrl({
      DATABASE_URL: NEON_POOLED,
      POSTGRES_URL: SUPABASE_POOLED,
    });
    expect(r).toEqual({ url: NEON_POOLED, source: "DATABASE_URL" });
  });

  it("accepts the Supabase and Vercel Postgres names", () => {
    expect(resolveDatabaseUrl({ POSTGRES_URL: SUPABASE_POOLED })).toEqual({
      url: SUPABASE_POOLED,
      source: "POSTGRES_URL",
    });
    expect(
      resolveDatabaseUrl({ POSTGRES_PRISMA_URL: SUPABASE_POOLED })?.source,
    ).toBe("POSTGRES_PRISMA_URL");
  });

  it("trims surrounding whitespace", () => {
    expect(
      resolveDatabaseUrl({ DATABASE_URL: `  ${NEON_POOLED}  ` })?.url,
    ).toBe(NEON_POOLED);
  });

  describe("preferDirect (migrations)", () => {
    it("picks the unpooled endpoint when one is published", () => {
      const env = {
        DATABASE_URL: NEON_POOLED,
        DATABASE_URL_UNPOOLED: NEON_DIRECT,
      };
      expect(resolveDatabaseUrl(env, { preferDirect: true })).toEqual({
        url: NEON_DIRECT,
        source: "DATABASE_URL_UNPOOLED",
      });
      // The runtime still gets the pooled one.
      expect(resolveDatabaseUrl(env)?.source).toBe("DATABASE_URL");
    });

    it("understands the Supabase non-pooling name", () => {
      const env = {
        POSTGRES_URL: SUPABASE_POOLED,
        POSTGRES_URL_NON_POOLING: SUPABASE_DIRECT,
      };
      expect(resolveDatabaseUrl(env, { preferDirect: true })?.source).toBe(
        "POSTGRES_URL_NON_POOLING",
      );
    });

    it("falls back to the pooled URL when no direct one exists", () => {
      expect(
        resolveDatabaseUrl(
          { DATABASE_URL: NEON_POOLED },
          { preferDirect: true },
        ),
      ).toEqual({
        url: NEON_POOLED,
        source: "DATABASE_URL",
      });
    });
  });
});

describe("looksPooled", () => {
  it("recognises Neon and Supabase pooler endpoints", () => {
    expect(looksPooled(NEON_POOLED)).toBe(true);
    expect(looksPooled(SUPABASE_POOLED)).toBe(true);
    expect(looksPooled("postgres://u:p@host/db?pgbouncer=true")).toBe(true);
  });

  it("does not flag direct endpoints", () => {
    expect(looksPooled(NEON_DIRECT)).toBe(false);
    expect(looksPooled(SUPABASE_DIRECT)).toBe(false);
    expect(looksPooled("postgres://ams:ams@localhost:5433/ams")).toBe(false);
  });
});

describe("databaseUrlCandidates", () => {
  it("lists DATABASE_URL first so error messages lead with the canonical name", () => {
    expect(databaseUrlCandidates()[0]).toBe("DATABASE_URL");
    expect(databaseUrlCandidates()).toContain("POSTGRES_URL");
  });
});
