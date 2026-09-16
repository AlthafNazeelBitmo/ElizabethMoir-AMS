import type { IncomingMessage, ServerResponse } from "node:http";
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
 */
let appPromise: Promise<App> | undefined;

function getApp(): Promise<App> {
  if (!appPromise) {
    appPromise = (async () => {
      const config = loadConfig({ NODE_ENV: "production", SPOOL_DIR: "/tmp/ams-spool", ...process.env });
      const { db } = createDb(config.DATABASE_URL, {
        statementTimeoutMs: config.DB_STATEMENT_TIMEOUT_MS,
        max: 1,
      });
      const app = await buildApp({ config, db });
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

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const app = await getApp();
  void app.store.drainSpool();
  app.server.server.emit("request", req, res);
}
