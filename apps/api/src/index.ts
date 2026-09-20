import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createDb } from "./db/client.js";
import { runMigrations } from "./db/migrate.js";

async function main(): Promise<void> {
  const config = loadConfig();

  // Migrations run on boot so a fresh container is usable without a manual
  // step. They are idempotent and recorded in the database.
  await runMigrations(config.DATABASE_URL);

  const { db, close } = createDb(config.DATABASE_URL, {
    statementTimeoutMs: config.DB_STATEMENT_TIMEOUT_MS,
  });
  const { server, store, processor } = await buildApp({ config, db });

  const drain = setInterval(() => void store.drainSpool(), config.SPOOL_DRAIN_INTERVAL_MS);
  drain.unref();
  void store.drainSpool();

  // Ingest starts processing as soon as a delivery is stored, so this is the
  // safety net: anything that failed, arrived while the process was down, or
  // was spooled to disk during an outage gets picked up here.
  let processing = false;
  const process_ = setInterval(() => {
    if (processing) return; // never let two runs overlap
    processing = true;
    void processor
      .processPending()
      .then(async (r) => {
        if (r.envelopesProcessed > 0) server.log.info(r, "processed pending envelopes");
        // Numbers that have since been given a name claim their scans.
        await processor.matchUnknownToDirectory();
        // The nightly absence job, idempotent and cheap to repeat.
        await processor.markAbsencesForToday();
      })
      .catch((err: unknown) => {
        server.log.error(
          { err: err instanceof Error ? err.message : String(err) },
          "scheduled processing failed",
        );
      })
      .finally(() => {
        processing = false;
      });
  }, config.PROCESS_INTERVAL_MS);
  process_.unref();

  const shutdown = async (signal: string) => {
    server.log.info({ signal }, "shutting down");
    clearInterval(drain);
    clearInterval(process_);
    await server.close();
    await close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  await server.listen({ host: config.HOST, port: config.PORT });
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
