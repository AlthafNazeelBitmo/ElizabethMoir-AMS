import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { App } from "../../src/app.js";
import { buildApp } from "../../src/app.js";
import { loadConfig } from "../../src/config.js";
import { hashPassword } from "../../src/auth/password.js";
import {
  groups,
  people,
  users,
  type UserRole,
} from "../../src/db/schema/index.js";
import { createTestDatabase, type TestDatabase } from "./db.js";

export const REPORT_TOKEN = "test-report-token-0123456789abcdefghij";
export const INGEST_TOKEN = "ingest-path-token-abcdefghijklmnop";
export const TEST_PASSWORD = "brass lantern quiet morning";

/**
 * Argon2id at production cost takes ~50ms per hash. Every seeded user shares
 * the same password, so hash it once for the whole run.
 */
let sharedHash: string | null = null;
async function testPasswordHash(): Promise<string> {
  sharedHash ??= await hashPassword(TEST_PASSWORD);
  return sharedHash;
}

export interface TestHarness {
  app: App;
  db: TestDatabase;
  /** Advance or set the clock the app sees, for session and lockout tests. */
  setNow: (d: Date) => void;
  close: () => Promise<void>;
}

export async function createHarness(
  opts: { now?: Date } = {},
): Promise<TestHarness> {
  const db = await createTestDatabase();
  const spoolDir = await mkdtemp(path.join(os.tmpdir(), "ams-test-spool-"));

  let clock = opts.now ?? new Date();
  const config = loadConfig({
    NODE_ENV: "test",
    DATABASE_URL: "postgres://unused:unused@127.0.0.1:5432/unused",
    REPORT_TOKEN,
    INGEST_PATH_TOKEN: INGEST_TOKEN,
    SPOOL_DIR: spoolDir,
    LOG_LEVEL: "fatal",
  });

  const app = await buildApp({ config, db: db.db, now: () => clock });
  await app.server.ready();

  return {
    app,
    db,
    setNow: (d) => {
      clock = d;
    },
    async close() {
      await app.server.close();
      await db.close();
      await rm(spoolDir, { recursive: true, force: true });
    },
  };
}

export interface SeededUser {
  id: string;
  email: string;
  role: UserRole;
}

export async function seedUser(
  h: TestHarness,
  opts: {
    email: string;
    role: UserRole;
    isActive?: boolean;
    mustChangePassword?: boolean;
  },
): Promise<SeededUser> {
  const [row] = await h.db.db
    .insert(users)
    .values({
      email: opts.email.toLowerCase(),
      passwordHash: await testPasswordHash(),
      fullName: opts.email.split("@")[0] ?? "Test User",
      role: opts.role,
      isActive: opts.isActive ?? true,
      mustChangePassword: opts.mustChangePassword ?? false,
    })
    .returning({ id: users.id, email: users.email, role: users.role });
  return row!;
}

/** The school's groups and a person in each branch, for isolation tests. */
export async function seedDirectory(h: TestHarness): Promise<{
  studentGroupId: number;
  staffGroupId: number;
}> {
  const [form1] = await h.db.db
    .insert(groups)
    .values({ name: "Form 1", branch: "student", displayOrder: 1 })
    .returning({ id: groups.id });
  const [juniorStaff] = await h.db.db
    .insert(groups)
    .values({ name: "Junior Staff", branch: "staff", displayOrder: 1 })
    .returning({ id: groups.id });

  await h.db.db.insert(people).values([
    { enrollNo: "11007", fullName: "A Student", groupId: form1!.id },
    { enrollNo: "11008", fullName: "Another Student", groupId: form1!.id },
    { enrollNo: "2001", fullName: "A Teacher", groupId: juniorStaff!.id },
    { enrollNo: "9999", fullName: "Unclassified Person", groupId: null },
  ]);

  return { studentGroupId: form1!.id, staffGroupId: juniorStaff!.id };
}

export interface LoggedIn {
  cookie: string;
  csrfToken: string;
  body: Record<string, unknown>;
}

/** Logs in and returns the cookie header and CSRF token for later requests. */
export async function login(
  h: TestHarness,
  email: string,
  password: string = TEST_PASSWORD,
): Promise<LoggedIn> {
  const res = await h.app.server.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email, password },
  });
  if (res.statusCode !== 200) {
    throw new Error(`login failed for ${email}: ${res.statusCode} ${res.body}`);
  }
  const body = res.json() as Record<string, unknown>;
  return {
    cookie: cookieHeader(res.cookies),
    csrfToken: String(body["csrfToken"]),
    body,
  };
}

export function cookieHeader(
  cookies: Array<{ name: string; value: string }>,
): string {
  return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
}
