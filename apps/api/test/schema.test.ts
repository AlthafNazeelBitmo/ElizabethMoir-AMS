import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "./helpers/db.js";

/**
 * Drizzle wraps driver errors, so the database's own message sits on the
 * cause chain. Collect the whole chain before matching.
 */
async function rejectionText(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    const parts: string[] = [];
    let e: unknown = err;
    while (e instanceof Error) {
      parts.push(e.message);
      e = (e as { cause?: unknown }).cause;
    }
    return parts.join(" | ");
  }
  throw new Error("expected the query to be rejected, but it succeeded");
}
import { auditLog, groups, people, users } from "../src/db/schema/index.js";

/**
 * The migrations are applied to a real (in-process) Postgres here, so these
 * tests check the constraints the database actually enforces — not what the
 * TypeScript types merely describe.
 */
let h: TestDatabase;

beforeAll(async () => {
  h = await createTestDatabase();
}, 60_000);

beforeEach(async () => {
  await h.truncateAll();
});

afterAll(async () => {
  await h.close();
});

describe("migrations", () => {
  it("create every table the specification lists", async () => {
    const res = await h.db.execute<{ table_name: string }>(sql`
      select table_name from information_schema.tables
      where table_schema = 'public' order by table_name
    `);
    const names = res.rows.map((r) => r.table_name);
    for (const expected of [
      "audit_log",
      "calendar_days",
      "day_records",
      "devices",
      "groups",
      "manual_adjustments",
      "people",
      "raw_events",
      "scans",
      "sessions",
      "settings",
      "tutors",
      "unknown_enrollments",
      "users",
    ]) {
      expect(names, `missing table ${expected}`).toContain(expected);
    }
  });
});

describe("users", () => {
  const valid = {
    email: "head@school.example",
    passwordHash: "x",
    fullName: "A Head",
    role: "full" as const,
  };

  it("accepts a well-formed row", async () => {
    const [row] = await h.db.insert(users).values(valid).returning();
    expect(row?.role).toBe("full");
    // Defaults from the specification.
    expect(row?.isActive).toBe(true);
    expect(row?.mustChangePassword).toBe(true);
    expect(row?.failedAttempts).toBe(0);
  });

  it("rejects an unknown role", async () => {
    await expect(
      h.db.insert(users).values({ ...valid, role: "superuser" as never }),
    ).rejects.toThrow();
  });

  it("rejects an email that is not already lowercased", async () => {
    await expect(
      h.db.insert(users).values({ ...valid, email: "Head@School.example" }),
    ).rejects.toThrow();
  });

  it("rejects a duplicate email", async () => {
    await h.db.insert(users).values(valid);
    await expect(
      h.db.insert(users).values({ ...valid, fullName: "Someone Else" }),
    ).rejects.toThrow();
  });
});

describe("groups", () => {
  it("rejects a branch outside student/staff", async () => {
    await expect(
      h.db.insert(groups).values({
        name: "Governors",
        branch: "board" as never,
        displayOrder: 1,
      }),
    ).rejects.toThrow();
  });

  it("defaults expects_attendance to true", async () => {
    const [g] = await h.db
      .insert(groups)
      .values({ name: "Form 1", branch: "student", displayOrder: 1 })
      .returning();
    expect(g?.expectsAttendance).toBe(true);
  });
});

describe("people", () => {
  it("allows a person with no group, which the register must tolerate", async () => {
    const [p] = await h.db
      .insert(people)
      .values({ enrollNo: "11007", fullName: "A Student" })
      .returning();
    expect(p?.groupId).toBeNull();
  });

  it("rejects a duplicate enrollment number", async () => {
    await h.db.insert(people).values({ enrollNo: "11007", fullName: "First" });
    await expect(
      h.db.insert(people).values({ enrollNo: "11007", fullName: "Second" }),
    ).rejects.toThrow();
  });
});

describe("audit_log is append-only", () => {
  async function anEntry() {
    const [row] = await h.db
      .insert(auditLog)
      .values({ action: "login_success", entity: "user", entityId: "abc" })
      .returning();
    return row!;
  }

  it("accepts inserts", async () => {
    const row = await anEntry();
    expect(row.action).toBe("login_success");
  });

  it("refuses updates at the database level, not merely in the application", async () => {
    const row = await anEntry();
    const text = await rejectionText(
      h.db.execute(
        sql`update audit_log set action = 'tampered' where id = ${row.id}`,
      ),
    );
    expect(text).toMatch(/append-only/);
  });

  it("refuses deletes", async () => {
    const row = await anEntry();
    const text = await rejectionText(
      h.db.execute(sql`delete from audit_log where id = ${row.id}`),
    );
    expect(text).toMatch(/append-only/);
  });

  it("keeps the entry after a rejected tamper attempt", async () => {
    const row = await anEntry();
    await h.db
      .execute(
        sql`update audit_log set action = 'tampered' where id = ${row.id}`,
      )
      .catch(() => undefined);
    const res = await h.db.execute<{ action: string }>(
      sql`select action from audit_log where id = ${row.id}`,
    );
    expect(res.rows[0]?.action).toBe("login_success");
  });
});
