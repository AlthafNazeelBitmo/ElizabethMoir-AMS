import { z } from "zod";

const boolFromEnv = z
  .enum(["true", "false", "1", "0"])
  .transform((v) => v === "true" || v === "1");

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),

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
   * Optional secret path segment for the ingest URL. When set, the endpoint
   * is POST /ingest/<token>/raw and the bare /ingest/raw 404s. Recommended
   * even for the discovery run so stray bots cannot pollute the sample.
   */
  INGEST_PATH_TOKEN: z.string().min(16).optional(),

  /** Hard cap on the ingest request body, in bytes. Spec: 1 MB. */
  INGEST_BODY_LIMIT_BYTES: z.coerce.number().int().positive().default(1_048_576),

  /** Where envelopes are spooled when the database is unreachable. */
  SPOOL_DIR: z.string().default("./data/spool"),

  /** How often the spool is drained back into the database. */
  SPOOL_DRAIN_INTERVAL_MS: z.coerce.number().int().positive().default(60_000),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  return parsed.data;
}
