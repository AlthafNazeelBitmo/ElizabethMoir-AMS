import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

export type Db = ReturnType<typeof createDb>["db"];

/**
 * A bounded-latency connection pool. The ingest path awaits its insert, so a
 * hung database must fail fast rather than hold the webhook open: both the
 * connect and the statement are capped at 5 seconds, after which the caller
 * falls back to the disk spool.
 */
export interface DbOptions {
  /** 0 disables the startup parameter (required behind a transaction pooler). */
  statementTimeoutMs?: number;
  /** Pool size; serverless entries use 1. */
  max?: number;
}

export function createDb(url: string, opts: DbOptions = {}) {
  const statementTimeoutMs = opts.statementTimeoutMs ?? 5000;
  const sql = postgres(url, {
    max: opts.max ?? 10,
    connect_timeout: 5,
    idle_timeout: 30,
    connection: {
      application_name: "ams-api",
      ...(statementTimeoutMs > 0 ? { statement_timeout: statementTimeoutMs } : {}),
    },
    onnotice: () => {},
  });
  const db = drizzle(sql, { schema });
  return { db, sql, close: () => sql.end({ timeout: 5 }) };
}
