/**
 * Resolving the Postgres connection string.
 *
 * `DATABASE_URL` is the canonical name and always wins. The fallbacks exist
 * because the managed-Postgres integrations name their variables differently
 * — Neon supplies `DATABASE_URL`, Supabase and Vercel Postgres supply
 * `POSTGRES_URL` — and a deployment failing because of a variable name is a
 * waste of everyone's afternoon.
 *
 * Pooled versus direct matters:
 *
 * - The **runtime** wants the pooled endpoint. Serverless instances are many
 *   and short-lived; a transaction pooler is what keeps Postgres from running
 *   out of connections.
 * - **Migrations** want the direct endpoint. DDL through a transaction-mode
 *   pooler can fail or behave oddly, and a migration runs once per deploy so
 *   it does not need pooling.
 */

/** Candidates in priority order. First one present and non-empty wins. */
const POOLED_CANDIDATES = [
  "DATABASE_URL",
  "POSTGRES_URL",
  "POSTGRES_PRISMA_URL",
  "DATABASE_POSTGRES_URL",
] as const;

const DIRECT_CANDIDATES = [
  "DATABASE_URL_UNPOOLED",
  "POSTGRES_URL_NON_POOLING",
  "DIRECT_DATABASE_URL",
  "DIRECT_URL",
] as const;

export interface ResolvedDatabaseUrl {
  url: string;
  /** The environment variable it came from, for logging. */
  source: string;
}

export interface ResolveOptions {
  /**
   * Prefer an unpooled/direct endpoint when one is published. Set for
   * migrations; leave false for the runtime.
   */
  preferDirect?: boolean;
}

export function resolveDatabaseUrl(
  env: Record<string, string | undefined>,
  opts: ResolveOptions = {},
): ResolvedDatabaseUrl | null {
  const order = opts.preferDirect
    ? [...DIRECT_CANDIDATES, ...POOLED_CANDIDATES]
    : [...POOLED_CANDIDATES, ...DIRECT_CANDIDATES];

  for (const name of order) {
    const value = env[name]?.trim();
    if (value) return { url: value, source: name };
  }
  return null;
}

/** Every variable name consulted, for error messages. */
export function databaseUrlCandidates(): string[] {
  return [...POOLED_CANDIDATES, ...DIRECT_CANDIDATES];
}

/**
 * True when the URL looks like a transaction-mode pooler endpoint, which
 * rejects the `statement_timeout` startup parameter. Used only to warn: the
 * operator still sets DB_STATEMENT_TIMEOUT_MS explicitly.
 */
export function looksPooled(url: string): boolean {
  return (
    /-pooler\./.test(url) ||
    /:6543(\/|\?|$)/.test(url) ||
    /[?&]pgbouncer=true/.test(url)
  );
}
