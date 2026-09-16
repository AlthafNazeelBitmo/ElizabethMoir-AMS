import { z } from "zod";
import { databaseUrlCandidates, resolveDatabaseUrl } from "./db/url.js";

const boolFromEnv = z
  .enum(["true", "false", "1", "0"])
  .transform((v) => v === "true" || v === "1");

const schema = z
  .object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),

  DATABASE_URL: z.url(),

  /**
   * Server-side statement timeout, sent as a startup parameter. Set to 0
   * when connecting through a transaction-mode pooler (Neon or Supabase
   * pooled URLs), which rejects unknown startup parameters.
   */
  DB_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(0).default(5000),

  /**
   * True when a reverse proxy (Caddy) terminates TLS in front of the API.
   * Makes Fastify read the client IP from X-Forwarded-For. Must be false when
   * the API is exposed directly, or anyone can spoof their source IP.
   */
  TRUST_PROXY: boolFromEnv.default(false),

  /** Static token protecting GET /ingest/report. ≥ 32 chars. */
  REPORT_TOKEN: z.string().min(32),

  /**
   * Secret path segment for the ingest URL. When set, the endpoint is
   * POST /ingest/<token>/raw and the bare /ingest/raw 404s.
   *
   * Optional in development, **required in production**: the webhook sends
   * no credentials of any kind, so this path segment is the only thing
   * standing between a publicly reachable deployment and anyone posting
   * fabricated attendance for any child. See the production check below.
   */
  INGEST_PATH_TOKEN: z.string().min(16).optional(),

  /** Hard cap on the ingest request body, in bytes. Spec: 1 MB. */
  INGEST_BODY_LIMIT_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(1_048_576),

  /** Where envelopes are spooled when the database is unreachable. */
  SPOOL_DIR: z.string().default("./data/spool"),

  /** How often the spool is drained back into the database. */
  SPOOL_DRAIN_INTERVAL_MS: z.coerce.number().int().positive().default(60_000),
})
  .superRefine((cfg, ctx) => {
    // A production deployment is, by definition, reachable. Without the path
    // token the ingest endpoint is an open write to a database of children's
    // movements, so refuse to start rather than expose it.
    if (cfg.NODE_ENV === "production" && !cfg.INGEST_PATH_TOKEN) {
      ctx.addIssue({
        code: "custom",
        path: ["INGEST_PATH_TOKEN"],
        message:
          "required when NODE_ENV=production: without it the ingest endpoint is /ingest/raw, which anyone who finds the URL can post fabricated attendance to",
      });
    }
  });

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // A managed-Postgres integration may publish the connection string under
  // its own name; accept those rather than failing on DATABASE_URL alone.
  const resolved = resolveDatabaseUrl(env);
  const withDb = resolved ? { ...env, DATABASE_URL: resolved.url } : env;

  const parsed = schema.safeParse(withDb);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    const hint =
      resolved === null
        ? `\n\nNo database connection string found. Set DATABASE_URL, or any of: ${databaseUrlCandidates().join(", ")}.`
        : "";
    throw new Error(`Invalid environment configuration:\n${problems}${hint}`);
  }
  return parsed.data;
}
