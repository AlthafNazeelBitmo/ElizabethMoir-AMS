import type { IncomingMessage, ServerResponse } from "node:http";
import { waitUntil } from "@vercel/functions";
import { buildApp, type App } from "./app.js";
import { loadConfig } from "./config.js";
import { createDb } from "./db/client.js";

/**
 * Entry for a serverless host (Vercel). The Fastify app is built once per
 * instance and reused across warm invocations. Migrations are NOT run here —
 * they run in the build step — and there is no persistent disk, so the
 * spool lives in /tmp and is drained opportunistically at the start of each
 * invocation. That is weaker than the long-running deployment: if the
 * database is unreachable and the instance is recycled before the next
 * request, the spooled delivery is gone. Acceptable for discovery, not for
 * production. See docs/DEPLOY-VERCEL.md.
 *
 * There is no process to hold the five-minute interval the long-running
 * deployment uses, and the platform's free plan only runs a cron once a
 * day. So every invocation stands in for the interval: at most once a
 * minute per instance it drains the spool, processes anything left pending
 * and marks the day's absences, kept alive past the response by the
 * platform rather than frozen with it. Any traffic at all — a register
 * open on a desk, a reader posting a scan — keeps the register current;
 * the daily cron is the floor for a day nobody looked.
 *
 * The same freeze would catch the processing a delivery triggers, half way
 * through, until the next request thawed it. The app is told it is on such
 * a host, so that work is kept alive too, and so the live stream tells its
 * clients to refetch on every reconnect: the process that answers the next
 * connection may not be the one that saw the scan.
 */
let appPromise: Promise<App> | undefined;

/** How often an instance sweeps. A minute is the long-running cadence's spirit. */
const SWEEP_INTERVAL_MS = 60_000;
let lastSweepAt = 0;

function getApp(): Promise<App> {
  if (!appPromise) {
    appPromise = (async () => {
      const config = loadConfig({
        NODE_ENV: "production",
        SPOOL_DIR: "/tmp/ams-spool",
        ...process.env,
      });
      const { db } = createDb(config.DATABASE_URL, {
        statementTimeoutMs: config.DB_STATEMENT_TIMEOUT_MS,
        max: 1,
      });
      const app = await buildApp({
        config,
        db,
        serverless: { keepAlive: (work) => waitUntil(work) },
      });
      await app.server.ready();
      return app;
    })();
    // A failed build must not be cached forever; let the next request retry.
    appPromise.catch(() => {
      appPromise = undefined;
    });
  }
  return appPromise;
}

function sweepIfDue(app: App): void {
  const now = Date.now();
  if (now - lastSweepAt < SWEEP_INTERVAL_MS) return;
  lastSweepAt = now;
  const work = (async () => {
    await app.store.drainSpool();
    await app.processor.processPending();
    await app.processor.matchUnknownToDirectory();
    await app.processor.markAbsencesForToday();
  })().catch((err: unknown) => {
    // A failed sweep is retried by the next one; it must never take the
    // request that triggered it down with it.
    console.error(
      "[sweep] failed:",
      err instanceof Error ? err.message : String(err),
    );
  });
  // Without this the platform freezes the instance as soon as the response
  // is sent, and the work is left half done until the next thaw.
  waitUntil(work);
}

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  let app: App;
  try {
    app = await getApp();
  } catch (err) {
    // Without valid configuration there is nothing this function can do, but
    // an unexplained platform-level crash is a poor way to find that out.
    // The reason goes to the function log; the caller gets a plain 503, since
    // naming the missing variables to the internet helps nobody.
    console.error(
      "[startup] the function cannot serve requests:",
      err instanceof Error ? err.message : String(err),
    );
    res.statusCode = 503;
    res.setHeader("content-type", "text/plain; charset=utf-8");
    res.setHeader("cache-control", "no-store");
    res.end("Service is misconfigured. See the deployment's function logs.\n");
    return;
  }
  sweepIfDue(app);
  app.server.server.emit("request", req, res);
}
