import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { hashPassword } from "../auth/password.js";
import { loadConfig } from "../config.js";
import { createDb } from "../db/client.js";
import { users, USER_ROLES, type UserRole } from "../db/schema/index.js";

/**
 * Creates an operator account.
 *
 *   pnpm --filter @ams/api create-user <email> <full|student_only> "<Full Name>"
 *
 * There is no seeded default account and no default password: a deployment
 * that ships with known credentials is a deployment with no authentication.
 * This prints a generated password once, to the operator's terminal, and the
 * account must change it on first login.
 */

function usage(message?: string): never {
  if (message) console.error(`error: ${message}\n`);
  console.error(
    [
      "usage: create-user <email> <role> <full name>",
      "",
      `  role   one of: ${USER_ROLES.join(", ")}`,
      "",
      'example: create-user head@school.lk full "A Head Teacher"',
    ].join("\n"),
  );
  process.exit(1);
}

/** Readable, unambiguous, and long enough that the policy accepts it. */
function generatePassword(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789"; // no l/1/o/0
  const bytes = randomBytes(20);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

async function main(): Promise<void> {
  const [emailArg, roleArg, ...nameParts] = process.argv.slice(2);
  if (!emailArg || !roleArg || nameParts.length === 0) usage();

  const email = emailArg.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
    usage(`"${emailArg}" is not an email address`);
  if (!USER_ROLES.includes(roleArg as UserRole))
    usage(`"${roleArg}" is not a role`);

  const config = loadConfig();
  const { db, close } = createDb(config.DATABASE_URL, {
    statementTimeoutMs: config.DB_STATEMENT_TIMEOUT_MS,
    max: 1,
  });

  try {
    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email));
    if (existing) {
      console.error(`error: ${email} already has an account`);
      process.exit(1);
    }

    const password = generatePassword();
    await db.insert(users).values({
      email,
      passwordHash: await hashPassword(password),
      fullName: nameParts.join(" "),
      role: roleArg as UserRole,
      mustChangePassword: true,
    });

    console.log("");
    console.log(`  Account created for ${email} (${roleArg}).`);
    console.log("");
    console.log(`  Temporary password:  ${password}`);
    console.log("");
    console.log(
      "  It is shown once and is not recoverable. Give it to the account",
    );
    console.log(
      "  holder over a channel you trust; they must change it at first login.",
    );
    console.log("");
  } finally {
    await close();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
