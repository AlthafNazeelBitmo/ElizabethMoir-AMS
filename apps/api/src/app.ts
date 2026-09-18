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
import multipart from "@fastify/multipart";
import { adminRoutes } from "./admin/routes.js";
import { adminSystemRoutes } from "./admin/system.js";
import { DirectoryImporter } from "./directory/import.js";
import { processingRoutes } from "./processing/routes.js";
import { RegisterBroadcaster } from "./register/broadcaster.js";
import { registerRoutes } from "./register/routes.js";
import { RegisterService } from "./register/service.js";
import { reportRoutes } from "./reports/routes.js";
import { LOGO_MAX_BYTES, LOGO_TYPES } from "./school/logo.js";
import { schoolRoutes } from "./school/routes.js";
import { ReportService } from "./reports/service.js";
import { ScanProcessor } from "./processing/processor.js";
import { SettingsService } from "./settings/service.js";

export interface AppDeps {
  config: Config;
  db: Db;
  /** Injectable for tests that need to control session and lockout timing. */
  now?: () => Date;
  /**
   * Present on a host that may freeze the process the moment a response is
   * sent and replace it between any two requests. `keepAlive` asks the host
   * to let a piece of background work finish; the live stream tells its
   * clients that nothing missed between connections can be replayed.
   */
  serverless?: {
    keepAlive: (work: Promise<unknown>) => void;
  };
}

export interface App {
  server: FastifyInstance;
  store: RawEventStore;
  auth: AuthService;
  processor: ScanProcessor;
  settings: SettingsService;
  register: RegisterService;
  reports: ReportService;
  broadcaster: RegisterBroadcaster;
  /**
   * Resolves once processing triggered by ingest has settled. Tests await
   * it; nothing in production needs to.
   */
  whenIdle: () => Promise<void>;
}

export async function buildApp({
  config,
  db,
  now,
  serverless,
}: AppDeps): Promise<App> {
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
  // Directory uploads. The ingest plugin replaces its own parsers inside its
  // encapsulated scope, so this does not affect it.
  await server.register(multipart, {
    limits: { fileSize: config.MAX_UPLOAD_BYTES, files: 1 },
  });
  // The school's mark arrives as the image itself. Bounded well below the
  // directory upload: a crest for a sidebar is kilobytes, not megabytes.
  server.addContentTypeParser(
    [...LOGO_TYPES],
    { parseAs: "buffer", bodyLimit: LOGO_MAX_BYTES },
    (_req, body, done) => done(null, body),
  );

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
  const settings = new SettingsService(db);
  const importer = new DirectoryImporter(db, server.log);
  const broadcaster = new RegisterBroadcaster();
  const register = new RegisterService(db, settings, now);
  const reports = new ReportService(db, settings);
  const processor = new ScanProcessor(db, settings, server.log, now, broadcaster);
  let backgroundWork: Promise<void> = Promise.resolve();
  const cookies: CookieContext = { secure: config.NODE_ENV === "production" };

  server.get("/healthz", async () => ({ ok: true }));
  // The root is where a person lands when they type the host in. It says
  // what this is and where to look, rather than a platform 404.
  server.get("/", async (_req, reply) =>
    reply.header("cache-control", "no-store").send({
      service: "attendance-api",
      ok: true,
      health: "/healthz",
      note: "The API has no pages; the register is served by the web app.",
    }),
  );

  await server.register(authRoutes, { auth, cookies });
  await server.register(ingestRoutes, {
    config,
    store,
    // Process as soon as the envelope is safely stored, without making the
    // upstream wait for it. On a long-running host this means a scan reaches
    // the register in milliseconds; on a serverless host the invocation may
    // be frozen first, which is harmless because the scheduled drain picks
    // it up and every step is idempotent.
    onStored: () => {
      // Chained rather than fired in parallel: two runs over the same
      // outstanding rows would duplicate work and race on the same
      // person-days. Failures are swallowed so the chain survives them; the
      // scheduled drain is the retry.
      backgroundWork = backgroundWork
        .then(() => processor.processPending())
        .then(() => undefined)
        .catch((err: unknown) => {
          server.log.error(
            { err: err instanceof Error ? err.message : String(err) },
            "post-ingest processing failed; the scheduled drain will retry",
          );
        });
      // A serverless host freezes the instance as soon as the 200 is sent,
      // with this chain half way through a query. Asking it to wait is
      // what turns "eventually, on the next request" into "now".
      serverless?.keepAlive(backgroundWork);
    },
  });
  await server.register(discoveryRoutes, { config, db });
  await server.register(processingRoutes, { config, processor });
  await server.register(registerRoutes, {
    db,
    auth,
    cookies,
    register,
    broadcaster,
    streamContinuity: serverless ? "none" : "buffer",
  });
  await server.register(schoolRoutes, { auth, cookies, settings });
  await server.register(reportRoutes, { db, auth, cookies, reports, settings });
  await server.register(adminRoutes, {
    db,
    auth,
    cookies,
    importer,
    processor,
    maxUploadBytes: config.MAX_UPLOAD_BYTES,
  });
  await server.register(adminSystemRoutes, { db, auth, cookies, settings, processor });

  return {
    server,
    store,
    auth,
    processor,
    settings,
    register,
    reports,
    broadcaster,
    whenIdle: () => backgroundWork,
  };
}
