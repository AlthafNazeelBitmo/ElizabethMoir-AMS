import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { databaseUrlCandidates, resolveDatabaseUrl } from "./url.js";

/**
 * Applies every migration in ./drizzle that has not yet been applied.
 * Migrations are generated with `pnpm db:generate` and committed; this is the
 * only way schema changes reach a database (spec §3: never hand-applied).
 */
export async function runMigrations(databaseUrl: string): Promise<void> {
  const sql = postgres(databaseUrl, { max: 1, connect_timeout: 15 });
  try {
    const db = drizzle(sql);
    const here = path.dirname(fileURLToPath(import.meta.url));
    await migrate(db, { migrationsFolder: path.resolve(here, "../../drizzle") });
  } finally {
    await sql.end();
  }
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (invokedDirectly) {
  // Migrations prefer a direct (unpooled) endpoint: DDL through a
  // transaction-mode pooler is unreliable, and this runs once per deploy.
  const resolved = resolveDatabaseUrl(process.env, { preferDirect: true });

  if (!resolved) {
    console.error(
      [
        "No database connection string found, so migrations cannot run.",
        "",
        "Set DATABASE_URL, or any one of these (checked in order):",
        ...databaseUrlCandidates().map((n) => `  - ${n}`),
        "",
        "On Vercel: Project -> Storage -> attach a Postgres database, then confirm",
        "the variable appears under Settings -> Environment Variables for the",
        "environment being built. Redeploy after adding it; variables are read at",
        "build time and an existing build will not pick them up.",
      ].join("\n"),
    );
    process.exit(1);
  }

  console.log(`applying migrations using ${resolved.source}`);
  runMigrations(resolved.url)
    .then(() => {
      console.log("migrations applied");
      process.exit(0);
    })
    .catch((err: unknown) => {
      console.error("migration failed:", err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
