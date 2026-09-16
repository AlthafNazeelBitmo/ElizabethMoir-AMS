import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp, type App } from "../src/app.js";
import { loadConfig, type Config } from "../src/config.js";
import { createDb } from "../src/db/client.js";
import { runMigrations } from "../src/db/migrate.js";
import { rawEvents } from "../src/db/schema.js";

/**
 * Exercises the Phase 0 contract end to end against a real Postgres:
 * whatever arrives at the ingest URL is answered with an empty 200 and lands
 * in raw_events exactly as sent.
 *
 * Requires DATABASE_URL_TEST (a database this test may truncate).
 */
const TEST_URL = process.env["DATABASE_URL_TEST"];
if (!TEST_URL) {
  throw new Error(
    "DATABASE_URL_TEST must point at a disposable Postgres database (see README: pnpm db:up)",
  );
}

const REPORT_TOKEN = "test-report-token-0123456789abcdefghij";
const INGEST_TOKEN = "ingest-path-token-abcdefghijklmnop";

const SAMPLE = [
  {
    EmpId: "20",
    AttTime: "2024-01-08 16:58:03",
    CheckingStatus: "0",
    VerifyType: "1",
    DeviceID: "CLXK221260271",
  },
  {
    EmpId: "20",
    AttTime: "2024-01-08 16:58:03",
    CheckingStatus: "1",
    VerifyType: "1",
    DeviceID: "CLXK221260271",
  },
  {
    EmpId: "24",
    AttTime: "2024-01-09 16:58:03",
    CheckingStatus: "0",
    VerifyType: "1",
    DeviceID: "CLXK221260271",
  },
];

let config: Config;
let handle: ReturnType<typeof createDb>;
let app: App;
let spoolDir: string;

beforeAll(async () => {
  spoolDir = await mkdtemp(path.join(os.tmpdir(), "ams-spool-"));
  config = loadConfig({
    NODE_ENV: "test",
    DATABASE_URL: TEST_URL,
    REPORT_TOKEN,
    INGEST_PATH_TOKEN: INGEST_TOKEN,
    SPOOL_DIR: spoolDir,
    LOG_LEVEL: "fatal",
    INGEST_BODY_LIMIT_BYTES: "1024",
  });
  await runMigrations(config.DATABASE_URL);
  handle = createDb(config.DATABASE_URL);
  app = await buildApp({ config, db: handle.db });
  await app.server.ready();
});

beforeEach(async () => {
  await handle.db.execute(sql`truncate table raw_events restart identity`);
});

afterAll(async () => {
  await app.server.close();
  await handle.close();
  await rm(spoolDir, { recursive: true, force: true });
});

const INGEST = `/ingest/${INGEST_TOKEN}/raw`;

async function rows() {
  return handle.db.select().from(rawEvents).orderBy(rawEvents.id);
}

describe("POST ingest — the vendor's happy path", () => {
  it("stores the batch verbatim and answers an empty 200", async () => {
    const body = JSON.stringify(SAMPLE);
    const res = await app.server.inject({
      method: "POST",
      url: INGEST,
      headers: { "content-type": "application/json", "x-custom-probe": "abc" },
      payload: body,
      remoteAddress: "203.0.113.7",
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("");

    const all = await rows();
    expect(all).toHaveLength(1);
    const r = all[0]!;
    expect(r.method).toBe("POST");
    expect(r.remoteIp).toBe("203.0.113.7");
    expect(r.contentType).toBe("application/json");
    expect(r.bodyText).toBe(body);
    expect(r.bodyJson).toEqual(SAMPLE);
    expect(r.batchSize).toBe(3);
    expect(r.bodyBytes).toBe(Buffer.byteLength(body));
    expect(r.parseError).toBeNull();
    expect(r.processedAt).toBeNull();
    expect((r.headers as Record<string, string>)["x-custom-probe"]).toBe("abc");
    expect(r.receivedAt.getTime()).toBeGreaterThan(Date.now() - 10_000);
  });
});

describe("POST ingest — never anything but 200", () => {
  it("accepts a body with no content-type header", async () => {
    const res = await app.server.inject({
      method: "POST",
      url: INGEST,
      payload: JSON.stringify(SAMPLE),
    });
    expect(res.statusCode).toBe(200);
    const [r] = await rows();
    expect(r?.batchSize).toBe(3);
  });

  it("accepts text/plain, form-encoded, and made-up content types", async () => {
    for (const ct of [
      "text/plain",
      "application/x-www-form-urlencoded",
      "application/vnd.vendor+weird",
      "garbage",
    ]) {
      const res = await app.server.inject({
        method: "POST",
        url: INGEST,
        headers: { "content-type": ct },
        payload: JSON.stringify(SAMPLE),
      });
      expect(res.statusCode, ct).toBe(200);
    }
    const all = await rows();
    expect(all.map((r) => r.contentType)).toEqual([
      "text/plain",
      "application/x-www-form-urlencoded",
      "application/vnd.vendor+weird",
      "garbage",
    ]);
    expect(all.every((r) => r.batchSize === 3)).toBe(true);
  });

  it("records malformed JSON as text with a parse error", async () => {
    const res = await app.server.inject({
      method: "POST",
      url: INGEST,
      headers: { "content-type": "application/json" },
      payload: "[{EmpId: 20, AttTime: broken}]",
    });
    expect(res.statusCode).toBe(200);
    const [r] = await rows();
    expect(r?.bodyText).toBe("[{EmpId: 20, AttTime: broken}]");
    expect(r?.bodyJson).toBeNull();
    expect(r?.parseError).toMatch(/^JSON parse failed/);
  });

  it("records an empty body", async () => {
    const res = await app.server.inject({
      method: "POST",
      url: INGEST,
      headers: { "content-type": "application/json" },
    });
    expect(res.statusCode).toBe(200);
    const [r] = await rows();
    expect(r?.parseError).toBe("empty body");
  });

  it("records a top-level object rather than an array", async () => {
    const res = await app.server.inject({
      method: "POST",
      url: INGEST,
      headers: { "content-type": "application/json" },
      payload: JSON.stringify(SAMPLE[0]),
    });
    expect(res.statusCode).toBe(200);
    const [r] = await rows();
    expect(r?.batchSize).toBeNull();
    expect(r?.parseError).toMatch(/not an array/);
  });

  it("discards an oversize body but records that it happened", async () => {
    const big = JSON.stringify(Array.from({ length: 50 }, () => SAMPLE[0]));
    expect(big.length).toBeGreaterThan(1024);
    const res = await app.server.inject({
      method: "POST",
      url: INGEST,
      headers: { "content-type": "application/json" },
      payload: big,
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("");
    const [r] = await rows();
    expect(r?.bodyText).toBeNull();
    expect(r?.bodyBytes).toBe(Buffer.byteLength(big));
    expect(r?.parseError).toMatch(/exceeded 1024 byte cap/);
  });

  it("accepts a non-POST method and records it", async () => {
    const res = await app.server.inject({
      method: "PUT",
      url: INGEST,
      payload: JSON.stringify(SAMPLE),
    });
    expect(res.statusCode).toBe(200);
    const [r] = await rows();
    expect(r?.method).toBe("PUT");
  });

  it("does not expose the unsecured path when a path token is configured", async () => {
    const res = await app.server.inject({
      method: "POST",
      url: "/ingest/raw",
      payload: JSON.stringify(SAMPLE),
    });
    expect(res.statusCode).toBe(404);
    expect(await rows()).toHaveLength(0);
  });
});

describe("Database outage", () => {
  it("still answers 200 and spools the envelope to disk, then drains it", async () => {
    // Point a second app at an unreachable database.
    const deadConfig = {
      ...config,
      DATABASE_URL: "postgres://nobody:nobody@127.0.0.1:1/none",
    };
    const dead = createDb(deadConfig.DATABASE_URL);
    const deadApp = await buildApp({ config: deadConfig, db: dead.db });
    try {
      const res = await deadApp.server.inject({
        method: "POST",
        url: INGEST,
        headers: { "content-type": "application/json" },
        payload: JSON.stringify(SAMPLE),
      });
      expect(res.statusCode).toBe(200);
      const spooled = (await readdir(spoolDir)).filter((f) =>
        f.endsWith(".json"),
      );
      expect(spooled).toHaveLength(1);
      expect(await rows()).toHaveLength(0);
    } finally {
      await deadApp.server.close();
      await dead.close();
    }

    // The healthy app shares the spool directory: its reconciler picks it up.
    await app.store.drainSpool();
    expect(
      (await readdir(spoolDir)).filter((f) => f.endsWith(".json")),
    ).toHaveLength(0);
    const [r] = await rows();
    expect(r?.bodyJson).toEqual(SAMPLE);
    expect(r?.batchSize).toBe(3);
  });
});

describe("GET /ingest/report", () => {
  it("404s without the token and renders with it", async () => {
    await app.server.inject({
      method: "POST",
      url: INGEST,
      headers: { "content-type": "application/json" },
      payload: JSON.stringify(SAMPLE),
    });

    expect(
      (await app.server.inject({ method: "GET", url: "/ingest/report" }))
        .statusCode,
    ).toBe(404);
    expect(
      (
        await app.server.inject({
          method: "GET",
          url: "/ingest/report",
          headers: { authorization: "Bearer wrong" },
        })
      ).statusCode,
    ).toBe(404);

    const res = await app.server.inject({
      method: "GET",
      url: "/ingest/report",
      headers: { authorization: `Bearer ${REPORT_TOKEN}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/html/);
    expect(res.headers["content-security-policy"]).toMatch(
      /default-src 'none'/,
    );
    expect(res.body).toContain("VerifyType");
    expect(res.body).toContain("CLXK221260271");
    expect(res.body).toContain("two-rows-per-tap artefact");

    const json = await app.server.inject({
      method: "GET",
      url: `/ingest/report.json?token=${REPORT_TOKEN}`,
    });
    expect(json.statusCode).toBe(200);
    expect(json.json().totals.events).toBe(3);
  });
});
