import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { fileURLToPath } from "node:url";
import path from "node:path";

/**
 * Applies every migration in ./drizzle that has not yet been applied.
 * Migrations are generated with `pnpm db:generate` and committed; this is the
 * only way schema changes reach a database (spec §3: never hand-applied).
 */
export async function runMigrations(databaseUrl: string): Promise<void> {
  const sql = postgres(databaseUrl, { max: 1, connect_timeout: 10 });
  try {
    const db = drizzle(sql);
    const here = path.dirname(fileURLToPath(import.meta.url));
    await migrate(db, { migrationsFolder: path.resolve(here, "../../drizzle") });
  } finally {
    await sql.end();
  }
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  const url = process.env["DATABASE_URL"];
  if (!url) {
    console.error("DATABASE_URL is not set");
    process.exit(1);
  }
  runMigrations(url)
    .then(() => {
      console.log("migrations applied");
      process.exit(0);
    })
    .catch((err: unknown) => {
      console.error(err);
      process.exit(1);
    });
}
