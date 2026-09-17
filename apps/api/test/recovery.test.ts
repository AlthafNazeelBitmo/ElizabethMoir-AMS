import { readdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import type { Db } from "../src/db/client.js";
import { rawEvents, scans } from "../src/db/schema/index.js";
import {
  createHarness,
  INGEST_TOKEN,
  REPORT_TOKEN,
  type TestHarness,
} from "./helpers/app.js";

/**
 * Specification §12: load and recovery.
 *
 * Recovery: the system must lose nothing when the parts underneath it
 * fail. These are not timing-sensitive, so they run in the ordinary suite.
 * The load measurements live in load.load.test.ts.
 */

const DEVICE = "DEMO000000001";

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

const INGEST = `/ingest/${INGEST_TOKEN}/raw`;

function batch(size: number, offset: number) {
  return Array.from({ length: size }, (_, i) => ({
    EmpId: String(11000 + ((offset + i) % 1200)),
    AttTime: `2026-09-16 ${String(7 + Math.floor(((offset + i) % 600) / 60)).padStart(2, "0")}:${String((offset + i) % 60).padStart(2, "0")}:00`,
    CheckingStatus: "0",
    VerifyType: "1",
    DeviceID: DEVICE,
  }));
}

describe("recovery", () => {
  it("loses nothing when the database is unreachable, and catches up after", async () => {
    const spoolDir = await mkdtemp(path.join(os.tmpdir(), "ams-recovery-"));
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

    const DELIVERIES = 40;
    try {
      for (let i = 0; i < DELIVERIES; i++) {
        const res = await broken.server.inject({
          method: "POST",
          url: INGEST,
          headers: { "content-type": "application/json" },
          payload: JSON.stringify(batch(5, i * 5)),
        });
        // The platform never retries, so it must never see a failure — not
        // even while the database is down.
        expect(res.statusCode).toBe(200);
      }

      const spooled = (await readdir(spoolDir)).filter((f) =>
        f.endsWith(".json"),
      );
      expect(spooled).toHaveLength(DELIVERIES);
      expect(await h.db.db.select().from(rawEvents)).toHaveLength(0);

      // The database comes back. A healthy app sharing the spool drains it.
      const recovered = await buildApp({ config, db: h.db.db });
      await recovered.server.ready();
      await recovered.store.drainSpool();
      await recovered.server.close();

      expect(
        (await readdir(spoolDir)).filter((f) => f.endsWith(".json")),
      ).toHaveLength(0);
      const [stored] = await h.db.db
        .select({ n: sql<number>`count(*)::int` })
        .from(rawEvents);
      expect(Number(stored?.n)).toBe(DELIVERIES);
    } finally {
      await broken.server.close();
      await rm(spoolDir, { recursive: true, force: true });
    }
  }, 60_000);

  it("keeps answering 200 when processing is failing entirely", async () => {
    // Ingest must be indifferent to whether interpretation works: the
    // envelope is what matters, and it can be replayed later.
    const spoolDir = await mkdtemp(path.join(os.tmpdir(), "ams-proc-fail-"));
    try {
      const config = loadConfig({
        NODE_ENV: "test",
        DATABASE_URL: "postgres://unused:unused@127.0.0.1:5432/unused",
        REPORT_TOKEN,
        INGEST_PATH_TOKEN: INGEST_TOKEN,
        SPOOL_DIR: spoolDir,
        LOG_LEVEL: "fatal",
      });
      const app = await buildApp({ config, db: h.db.db });
      await app.server.ready();
      // Break processing after the app is built.
      app.processor.processPending = () =>
        Promise.reject(new Error("processor is down"));

      for (let i = 0; i < 10; i++) {
        const res = await app.server.inject({
          method: "POST",
          url: INGEST,
          headers: { "content-type": "application/json" },
          payload: JSON.stringify(batch(3, i * 3)),
        });
        expect(res.statusCode).toBe(200);
      }
      await app.whenIdle();
      await app.server.close();

      // Every envelope is stored and outstanding, ready to be replayed.
      const [stored] = await h.db.db
        .select({ n: sql<number>`count(*)::int` })
        .from(rawEvents);
      expect(Number(stored?.n)).toBe(10);
    } finally {
      await rm(spoolDir, { recursive: true, force: true });
    }
  }, 60_000);

  it("replays the whole backlog correctly once processing recovers", async () => {
    for (let i = 0; i < 20; i++) {
      await h.app.server.inject({
        method: "POST",
        url: INGEST,
        headers: { "content-type": "application/json" },
        payload: JSON.stringify(batch(5, i * 5)),
      });
    }
    await h.app.whenIdle();

    // Pretend none of it was ever processed, as a recovered outage would.
    await h.db.db
      .update(rawEvents)
      .set({ processedAt: null, processError: null });
    const before = await h.db.db
      .select({ n: sql<number>`count(*)::int` })
      .from(scans);

    for (let i = 0; i < 10; i++) {
      const result = await h.app.processor.processPending();
      if (result.envelopesProcessed === 0) break;
    }

    const after = await h.db.db
      .select({ n: sql<number>`count(*)::int` })
      .from(scans);
    // A full replay changes nothing: the dedupe key makes it idempotent.
    expect(Number(after[0]?.n)).toBe(Number(before[0]?.n));

    const [unprocessed] = await h.db.db
      .select({ n: sql<number>`count(*)::int` })
      .from(rawEvents)
      .where(sql`${rawEvents.processedAt} is null`);
    expect(Number(unprocessed?.n)).toBe(0);
  }, 120_000);
});
