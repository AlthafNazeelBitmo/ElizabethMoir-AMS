import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createDb } from "./db/client.js";
import { runMigrations } from "./db/migrate.js";

async function main(): Promise<void> {
  const config = loadConfig();

  // Migrations run on boot so a fresh container is usable without a manual
  // step. They are idempotent and recorded in the database.
  await runMigrations(config.DATABASE_URL);

  const { db, close } = createDb(config.DATABASE_URL);
  const { server, store } = await buildApp({ config, db });

  const drain = setInterval(() => void store.drainSpool(), config.SPOOL_DRAIN_INTERVAL_MS);
  drain.unref();
  void store.drainSpool();

  const shutdown = async (signal: string) => {
    server.log.info({ signal }, "shutting down");
    clearInterval(drain);
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
