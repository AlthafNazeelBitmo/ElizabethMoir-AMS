import Fastify, { LogController, type FastifyInstance } from "fastify";
import type { Config } from "./config.js";
import type { Db } from "./db/client.js";
import { discoveryRoutes } from "./discovery/routes.js";
import { ingestRoutes } from "./ingest/routes.js";
import { Spool } from "./ingest/spool.js";
import { RawEventStore } from "./ingest/store.js";
import { loggerOptions } from "./logger.js";

export interface AppDeps {
  config: Config;
  db: Db;
}

export interface App {
  server: FastifyInstance;
  store: RawEventStore;
}

export async function buildApp({ config, db }: AppDeps): Promise<App> {
  const server = Fastify({
    logger: loggerOptions(config),
    trustProxy: config.TRUST_PROXY,
    bodyLimit: config.INGEST_BODY_LIMIT_BYTES,
    // Per-request access lines would carry IPs and URLs; routes log what they need.
    logController: new LogController({ disableRequestLogging: true }),
    // Never let the framework advertise itself; the ingest URL is a credential.
    exposeHeadRoutes: false,
  });

  const spool = new Spool(config.SPOOL_DIR);
  await spool.init();
  const store = new RawEventStore(db, spool, server.log);

  server.get("/healthz", async () => ({ ok: true }));

  await server.register(ingestRoutes, { config, store });
  await server.register(discoveryRoutes, { config, db });

  return { server, store };
}
