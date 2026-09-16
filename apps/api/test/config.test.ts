import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const DB = "postgres://u:p@host:5432/db";
const REPORT = "r".repeat(32);
const INGEST = "i".repeat(16);

const base = {
  DATABASE_URL: DB,
  REPORT_TOKEN: REPORT,
  INGEST_PATH_TOKEN: INGEST,
};

describe("loadConfig", () => {
  it("accepts a complete environment and applies defaults", () => {
    const c = loadConfig({ ...base });
    expect(c.DATABASE_URL).toBe(DB);
    expect(c.PORT).toBe(3000);
    expect(c.NODE_ENV).toBe("development");
    expect(c.TRUST_PROXY).toBe(false);
    expect(c.INGEST_BODY_LIMIT_BYTES).toBe(1_048_576);
    expect(c.DB_STATEMENT_TIMEOUT_MS).toBe(5000);
  });

  it("reports a missing REPORT_TOKEN by name", () => {
    expect(() => loadConfig({ DATABASE_URL: DB })).toThrow(/REPORT_TOKEN/);
  });

  it("rejects a REPORT_TOKEN that is too short to be worth having", () => {
    expect(() => loadConfig({ ...base, REPORT_TOKEN: "short" })).toThrow(
      /REPORT_TOKEN/,
    );
  });

  it("names every missing variable at once, not just the first", () => {
    let message = "";
    try {
      loadConfig({});
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }
    expect(message).toMatch(/DATABASE_URL/);
    expect(message).toMatch(/REPORT_TOKEN/);
  });

  it("suggests the alternative connection-string names when none is set", () => {
    expect(() => loadConfig({ REPORT_TOKEN: REPORT })).toThrow(/POSTGRES_URL/);
  });

  it("picks up a connection string published under an integration's own name", () => {
    const c = loadConfig({ POSTGRES_URL: DB, REPORT_TOKEN: REPORT });
    expect(c.DATABASE_URL).toBe(DB);
  });

  describe("production hardening", () => {
    it("refuses to start without INGEST_PATH_TOKEN", () => {
      expect(() =>
        loadConfig({
          DATABASE_URL: DB,
          REPORT_TOKEN: REPORT,
          NODE_ENV: "production",
        }),
      ).toThrow(/INGEST_PATH_TOKEN/);
    });

    it("explains why, in terms of the exposure", () => {
      let message = "";
      try {
        loadConfig({
          DATABASE_URL: DB,
          REPORT_TOKEN: REPORT,
          NODE_ENV: "production",
        });
      } catch (e) {
        message = e instanceof Error ? e.message : String(e);
      }
      expect(message).toMatch(/anyone who finds the URL/);
    });

    it("starts once the token is supplied", () => {
      const c = loadConfig({ ...base, NODE_ENV: "production" });
      expect(c.INGEST_PATH_TOKEN).toBe(INGEST);
    });

    it("still allows development without one, for the spec's literal /ingest/raw", () => {
      const c = loadConfig({ DATABASE_URL: DB, REPORT_TOKEN: REPORT });
      expect(c.INGEST_PATH_TOKEN).toBeUndefined();
    });
  });

  describe("DB_STATEMENT_TIMEOUT_MS", () => {
    it("accepts 0, meaning omit the startup parameter for a pooler", () => {
      expect(
        loadConfig({ ...base, DB_STATEMENT_TIMEOUT_MS: "0" })
          .DB_STATEMENT_TIMEOUT_MS,
      ).toBe(0);
    });

    it("rejects a negative value", () => {
      expect(() =>
        loadConfig({ ...base, DB_STATEMENT_TIMEOUT_MS: "-1" }),
      ).toThrow();
    });
  });
});
