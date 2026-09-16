import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { sql } from "drizzle-orm";
import * as schema from "../../src/db/schema/index.js";

/**
 * A real Postgres for tests, running in-process via PGlite — no Docker, no
 * shared server, and a fresh database per suite so tests cannot interfere.
 *
 * The committed migrations are applied exactly as they will be in
 * production, so this doubles as a check that the SQL is valid.
 */
export type TestDb = ReturnType<typeof drizzle<typeof schema>>;

export interface TestDatabase {
  db: TestDb;
  /** Empties every table, preserving the schema. Use between tests. */
  truncateAll: () => Promise<void>;
  close: () => Promise<void>;
}

const MIGRATIONS_FOLDER = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../drizzle",
);

export async function createTestDatabase(): Promise<TestDatabase> {
  const client = new PGlite();
  await client.waitReady;
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

  return {
    db,
    async truncateAll() {
      // audit_log has a trigger forbidding DELETE; TRUNCATE is not a DELETE
      // and is deliberately still allowed, so tests can reset it.
      await db.execute(sql`
        truncate table
          audit_log, manual_adjustments, day_records, scans, raw_events,
          unknown_enrollments, people, tutors, groups, devices,
          settings, calendar_days, sessions, users
        restart identity cascade
      `);
    },
    async close() {
      await client.close();
    },
  };
}
