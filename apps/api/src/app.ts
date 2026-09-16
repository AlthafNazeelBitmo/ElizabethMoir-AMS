import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import Fastify, { LogController, type FastifyInstance } from "fastify";
import { AuthService } from "./auth/service.js";
import { authRoutes } from "./auth/routes.js";
import type { CookieContext } from "./auth/http.js";
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
  /** Injectable for tests that need to control session and lockout timing. */
  now?: () => Date;
}

export interface App {
  server: FastifyInstance;
  store: RawEventStore;
  auth: AuthService;
}

export async function buildApp({ config, db, now }: AppDeps): Promise<App> {
  const server = Fastify({
    logger: loggerOptions(config),
    trustProxy: config.TRUST_PROXY,
    bodyLimit: config.INGEST_BODY_LIMIT_BYTES,
    // Per-request access lines would carry IPs and URLs; routes log what they need.
    logController: new LogController({ disableRequestLogging: true }),
    // Never let the framework advertise itself; the ingest URL is a credential.
    exposeHeadRoutes: false,
  });

  // Cookies are plain: the session value is already 256 bits of randomness
  // and is stored hashed, so signing it would add a key to manage for nothing.
  await server.register(cookie);

  // Strict by default. This is an API; it serves no scripts, styles or
  // images. The one HTML page (the Phase 0 report) sets its own policy.
  await server.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        "default-src": ["'none'"],
        "frame-ancestors": ["'none'"],
        "base-uri": ["'none'"],
        "form-action": ["'none'"],
      },
    },
    crossOriginResourcePolicy: { policy: "same-origin" },
    referrerPolicy: { policy: "no-referrer" },
    hsts: config.NODE_ENV === "production" ? { maxAge: 31_536_000, includeSubDomains: true } : false,
  });

  const spool = new Spool(config.SPOOL_DIR);
  if (!(await spool.init())) {
    server.log.error(
      { dir: config.SPOOL_DIR },
      "spool directory unavailable; database outages will lose deliveries",
    );
  }
  const store = new RawEventStore(db, spool, server.log);
  const auth = new AuthService(db, server.log, now);
  const cookies: CookieContext = { secure: config.NODE_ENV === "production" };

  server.get("/healthz", async () => ({ ok: true }));

  await server.register(authRoutes, { auth, cookies });
  await server.register(ingestRoutes, { config, store });
  await server.register(discoveryRoutes, { config, db });

  return { server, store, auth };
}
