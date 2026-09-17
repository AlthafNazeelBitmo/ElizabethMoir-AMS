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
 * Load, measured against PGlite — real Postgres, but compiled to
 * WebAssembly and running inside this process, so slower than a server with
 * a socket to a real database. Treat the numbers as a floor rather than a
 * prediction.
 *
 * This file is deliberately kept out of `pnpm test` and run on its own by
 * `pnpm test:load`. A latency assertion competing with other test files for
 * the CPU measures the machine it ran on, not the code, and a test that
 * fails for that reason teaches people to ignore failures.
 */

const DEVICE = "TEST000000001";

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

describe("load", () => {
  it("accepts 5,000 events without losing any, and answers quickly", async () => {
    // 500 deliveries of 10 events, the shape the platform sends.
    const DELIVERIES = 500;
    const PER_DELIVERY = 10;
    const durations: number[] = [];

    for (let i = 0; i < DELIVERIES; i++) {
      const started = process.hrtime.bigint();
      const res = await h.app.server.inject({
        method: "POST",
        url: INGEST,
        headers: { "content-type": "application/json" },
        payload: JSON.stringify(batch(PER_DELIVERY, i * PER_DELIVERY)),
      });
      durations.push(Number(process.hrtime.bigint() - started) / 1_000_000);
      expect(res.statusCode).toBe(200);
    }

    // Nothing is lost: every delivery is on disk before the response.
    const [stored] = await h.db.db
      .select({ n: sql<number>`count(*)::int` })
      .from(rawEvents);
    expect(Number(stored?.n)).toBe(DELIVERIES);

    durations.sort((a, b) => a - b);
    const p99 = durations[Math.floor(durations.length * 0.99)]!;
    const median = durations[Math.floor(durations.length * 0.5)]!;

    // Reported rather than silently swallowed, so a regression is visible.
    console.log(
      `    ingest latency over ${DELIVERIES} deliveries: median ${median.toFixed(1)}ms, p99 ${p99.toFixed(1)}ms`,
    );

    // The specification's target is 50ms p99 against a real database. This
    // asserts a looser bound because PGlite is slower than a socket to
    // Postgres; the point of the assertion is to catch a change that makes
    // ingest an order of magnitude worse, not to certify production.
    expect(p99).toBeLessThan(250);
  }, 120_000);

  it("processes a burst of 5,000 events into scans without duplicating any", async () => {
    const DELIVERIES = 250;
    const PER_DELIVERY = 20;
    for (let i = 0; i < DELIVERIES; i++) {
      await h.app.server.inject({
        method: "POST",
        url: INGEST,
        headers: { "content-type": "application/json" },
        payload: JSON.stringify(batch(PER_DELIVERY, i * PER_DELIVERY)),
      });
    }
    await h.app.whenIdle();

    // Drain whatever the inline trigger did not finish.
    for (let i = 0; i < 40; i++) {
      const result = await h.app.processor.processPending();
      if (result.envelopesProcessed === 0) break;
    }

    const [unprocessed] = await h.db.db
      .select({ n: sql<number>`count(*)::int` })
      .from(rawEvents)
      .where(sql`${rawEvents.processedAt} is null`);
    expect(Number(unprocessed?.n)).toBe(0);

    // Every distinct event became exactly one scan. The generator repeats
    // (enrolment, time, device) tuples, so this also proves deduplication
    // held under load rather than merely not crashing.
    const [scanCount] = await h.db.db
      .select({ n: sql<number>`count(*)::int` })
      .from(scans);
    const [distinctKeys] = await h.db.db
      .select({ n: sql<number>`count(distinct ${scans.dedupeKey})::int` })
      .from(scans);
    expect(Number(scanCount?.n)).toBe(Number(distinctKeys?.n));
    expect(Number(scanCount?.n)).toBeGreaterThan(0);
  }, 180_000);
});
