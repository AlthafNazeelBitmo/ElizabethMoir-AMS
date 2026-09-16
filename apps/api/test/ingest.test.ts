import { readdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import type { Db } from "../src/db/client.js";
import { rawEvents } from "../src/db/schema/index.js";
import {
  createHarness,
  INGEST_TOKEN,
  REPORT_TOKEN,
  type TestHarness,
} from "./helpers/app.js";

/**
 * The Phase 0 contract, end to end against a real Postgres: whatever arrives
 * at the ingest URL is answered with an empty 200 and lands in raw_events
 * exactly as it was sent.
 */
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

const INGEST = `/ingest/${INGEST_TOKEN}/raw`;

let h: TestHarness;

beforeAll(async () => {
  h = await createHarness();
}, 60_000);

beforeEach(async () => {
  await h.db.truncateAll();
});

afterAll(async () => {
  await h.close();
});

const rows = () => h.db.db.select().from(rawEvents).orderBy(rawEvents.id);

const send = (opts: {
  method?: "POST" | "PUT" | "GET";
  url?: string;
  contentType?: string;
  payload?: string | Buffer;
  ip?: string;
  extraHeaders?: Record<string, string>;
}) =>
  h.app.server.inject({
    method: opts.method ?? "POST",
    url: opts.url ?? INGEST,
    ...(opts.payload === undefined ? {} : { payload: opts.payload }),
    headers: {
      ...(opts.contentType ? { "content-type": opts.contentType } : {}),
      ...(opts.extraHeaders ?? {}),
    },
    ...(opts.ip ? { remoteAddress: opts.ip } : {}),
  });

describe("the vendor's happy path", () => {
  it("stores the batch verbatim and answers an empty 200", async () => {
    const body = JSON.stringify(SAMPLE);
    const res = await send({
      contentType: "application/json",
      payload: body,
      ip: "203.0.113.7",
      extraHeaders: { "x-custom-probe": "abc" },
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
  });
});

describe("never anything but 200", () => {
  it("accepts a body with no content-type header", async () => {
    const res = await send({ payload: JSON.stringify(SAMPLE) });
    expect(res.statusCode).toBe(200);
    expect((await rows())[0]?.batchSize).toBe(3);
  });

  it("accepts text/plain, form-encoded, and made-up content types", async () => {
    const types = [
      "text/plain",
      "application/x-www-form-urlencoded",
      "application/vnd.vendor+weird",
      "garbage",
    ];
    for (const ct of types) {
      const res = await send({
        contentType: ct,
        payload: JSON.stringify(SAMPLE),
      });
      expect(res.statusCode, ct).toBe(200);
    }
    const all = await rows();
    expect(all.map((r) => r.contentType)).toEqual(types);
    expect(all.every((r) => r.batchSize === 3)).toBe(true);
  });

  it("records malformed JSON as text with a parse error", async () => {
    const res = await send({
      contentType: "application/json",
      payload: "[{EmpId: 20, AttTime: broken}]",
    });
    expect(res.statusCode).toBe(200);
    const r = (await rows())[0];
    expect(r?.bodyText).toBe("[{EmpId: 20, AttTime: broken}]");
    expect(r?.bodyJson).toBeNull();
    expect(r?.parseError).toMatch(/^JSON parse failed/);
  });

  it("records an empty body", async () => {
    const res = await send({ contentType: "application/json" });
    expect(res.statusCode).toBe(200);
    expect((await rows())[0]?.parseError).toBe("empty body");
  });

  it("records a top-level object rather than an array", async () => {
    const res = await send({
      contentType: "application/json",
      payload: JSON.stringify(SAMPLE[0]),
    });
    expect(res.statusCode).toBe(200);
    const r = (await rows())[0];
    expect(r?.batchSize).toBeNull();
    expect(r?.parseError).toMatch(/not an array/);
  });

  it("records a body that is not valid UTF-8", async () => {
    const res = await send({
      contentType: "application/octet-stream",
      payload: Buffer.from([0xff, 0xfe, 0x00, 0x41]),
    });
    expect(res.statusCode).toBe(200);
    expect((await rows())[0]?.parseError).toMatch(/not valid UTF-8/);
  });

  it("accepts a non-POST method and records it", async () => {
    const res = await send({ method: "PUT", payload: JSON.stringify(SAMPLE) });
    expect(res.statusCode).toBe(200);
    expect((await rows())[0]?.method).toBe("PUT");
  });

  it("does not expose the unsecured path when a path token is configured", async () => {
    const res = await send({
      url: "/ingest/raw",
      payload: JSON.stringify(SAMPLE),
    });
    expect(res.statusCode).toBe(404);
    expect(await rows()).toHaveLength(0);
  });
});

describe("when the database refuses the insert", () => {
  it("still answers 200, spools to disk, and drains once it recovers", async () => {
    const spoolDir = await mkdtemp(path.join(os.tmpdir(), "ams-outage-"));
    // A database that fails every insert, standing in for an outage.
    const brokenDb = {
      insert: () => ({
        values: () => Promise.reject(new Error("connection refused")),
      }),
    } as unknown as Db;

    const config = loadConfig({
      NODE_ENV: "test",
      DATABASE_URL: "postgres://unused:unused@127.0.0.1:5432/unused",
      REPORT_TOKEN,
      INGEST_PATH_TOKEN: INGEST_TOKEN,
      SPOOL_DIR: spoolDir,
      LOG_LEVEL: "fatal",
    });
    const broken = await buildApp({ config, db: brokenDb });
    await broken.server.ready();

    try {
      const res = await broken.server.inject({
        method: "POST",
        url: INGEST,
        headers: { "content-type": "application/json" },
        payload: JSON.stringify(SAMPLE),
      });
      // The upstream platform never retries, so it must never see a failure.
      expect(res.statusCode).toBe(200);
      expect(
        (await readdir(spoolDir)).filter((f) => f.endsWith(".json")),
      ).toHaveLength(1);
      expect(await rows()).toHaveLength(0);

      // A healthy app pointed at the same spool picks the delivery up.
      const recovered = await buildApp({ config, db: h.db.db });
      await recovered.server.ready();
      await recovered.store.drainSpool();
      await recovered.server.close();

      expect(
        (await readdir(spoolDir)).filter((f) => f.endsWith(".json")),
      ).toHaveLength(0);
      const all = await rows();
      expect(all).toHaveLength(1);
      expect(all[0]?.bodyJson).toEqual(SAMPLE);
      expect(all[0]?.batchSize).toBe(3);
    } finally {
      await broken.server.close();
      await rm(spoolDir, { recursive: true, force: true });
    }
  });
});

describe("GET /ingest/report", () => {
  beforeEach(async () => {
    await send({
      contentType: "application/json",
      payload: JSON.stringify(SAMPLE),
    });
  });

  it("404s without a token", async () => {
    expect(
      (await h.app.server.inject({ method: "GET", url: "/ingest/report" }))
        .statusCode,
    ).toBe(404);
  });

  it("404s with the wrong token", async () => {
    const res = await h.app.server.inject({
      method: "GET",
      url: "/ingest/report",
      headers: { authorization: "Bearer wrong" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("renders the findings with the token", async () => {
    const res = await h.app.server.inject({
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
  });

  it("serves the same analysis as JSON", async () => {
    const res = await h.app.server.inject({
      method: "GET",
      url: `/ingest/report.json?token=${REPORT_TOKEN}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().totals.events).toBe(3);
    expect(res.json().totals.distinctEmpIds).toBe(2);
  });
});
