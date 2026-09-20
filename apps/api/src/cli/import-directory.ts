import { readFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { loadConfig } from "../config.js";
import { createDb } from "../db/client.js";
import { users } from "../db/schema/index.js";
import { DirectoryImporter } from "../directory/import.js";

/**
 * Loads the school's directory from a spreadsheet export, from the command
 * line.
 *
 *   pnpm --filter @ams/api import-directory people.csv
 *   pnpm --filter @ams/api import-directory people.csv --confirm
 *
 * The first form previews. The second applies exactly what the preview
 * showed — the same two-step confirmation the admin screen uses, through
 * the same code — so the file can be loaded before the web interface
 * exists. Deactivations need `--confirm-deactivations` as well.
 */

const silentLogger = {
  info() {}, warn() {}, debug() {}, trace() {}, fatal() {}, silent() {},
  error(...args: unknown[]) {
    console.error(...args);
  },
  child() {
    return silentLogger;
  },
  level: "error",
} as never;

function usage(message?: string): never {
  if (message) console.error(`error: ${message}\n`);
  console.error(
    [
      "usage: import-directory <file.csv> [--confirm] [--confirm-deactivations] [--as <email>]",
      "",
      "  Without --confirm, prints what would change and writes nothing.",
      "  --as names the account the change is attributed to in the audit log;",
      "  it defaults to the first full-role account.",
    ].join("\n"),
  );
  process.exit(1);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith("--"));
  if (!file) usage("no file given");

  const confirm = args.includes("--confirm");
  const confirmDeactivations = args.includes("--confirm-deactivations");
  const skipDeactivations = args.includes("--skip-deactivations");
  const asIndex = args.indexOf("--as");
  const asEmail = asIndex >= 0 ? args[asIndex + 1] : undefined;

  const csvText = await readFile(file, "utf8");
  const config = loadConfig();
  const { db, close } = createDb(config.DATABASE_URL, {
    statementTimeoutMs: config.DB_STATEMENT_TIMEOUT_MS,
    max: 1,
  });

  try {
    const importer = new DirectoryImporter(db, silentLogger);
    const { plan, problems } = await importer.buildPlan(csvText);

    if (plan === null) {
      console.error(`\n  ${problems.length} problem(s). Nothing was imported.\n`);
      for (const p of problems) {
        const where = p.lineNumber === null ? "file" : `line ${p.lineNumber}`;
        console.error(`  ${where}${p.column ? ` (${p.column})` : ""}: ${p.message}`);
      }
      console.error("");
      process.exit(1);
    }

    console.log("");
    console.log(`  create      ${plan.creates.length}`);
    console.log(`  update      ${plan.updates.length}`);
    console.log(`  deactivate  ${plan.deactivates.length}`);
    console.log(`  unchanged   ${plan.unchangedCount}`);
    console.log(`  new tutors  ${plan.newTutorInitials.length}`);
    console.log("");

    if (plan.deactivates.length > 0) {
      console.log("  These people would be deactivated:");
      for (const d of plan.deactivates) console.log(`    ${d.enrollNo}  ${d.fullName}`);
      console.log("");
    }

    if (!confirm) {
      console.log("  Nothing was written. Re-run with --confirm to apply.");
      console.log("");
      return;
    }

    const actor = asEmail
      ? await db.select({ id: users.id }).from(users).where(eq(users.email, asEmail.toLowerCase())).limit(1)
      : await db.select({ id: users.id }).from(users).where(eq(users.role, "full")).limit(1);
    if (actor.length === 0) {
      console.error("  No account to attribute this to. Create one with create-user first.");
      process.exit(1);
    }

    const outcome = await importer.apply(csvText, plan.hash, {
      deactivations: confirmDeactivations
        ? "confirm"
        : skipDeactivations
          ? "skip"
          : "ask",
      userId: actor[0]!.id,
      ip: null,
      userAgent: "import-directory cli",
    });

    if (!outcome.ok) {
      if (outcome.reason === "needs_deactivation_confirmation") {
        console.error("  Re-run with --confirm-deactivations to remove the people listed above.");
      } else {
        console.error(`  Not imported: ${outcome.reason}.`);
      }
      console.error("");
      process.exit(1);
    }

    console.log(`  Imported. ${outcome.result.created} created, ${outcome.result.updated} updated, ${outcome.result.deactivated} deactivated.`);
    console.log("");
  } finally {
    await close();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
