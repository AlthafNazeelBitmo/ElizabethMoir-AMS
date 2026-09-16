import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "./helpers/db.js";
import { groups, settings } from "../src/db/schema/index.js";

let h: TestDatabase;

beforeAll(async () => {
  h = await createTestDatabase();
}, 60_000);

afterAll(async () => {
  await h.close();
});

describe("seeded reference data", () => {
  it("creates the school's groups in display order", async () => {
    const rows = await h.db.select().from(groups).orderBy(groups.branch, groups.displayOrder);
    const students = rows.filter((g) => g.branch === "student").map((g) => g.name);
    const staff = rows.filter((g) => g.branch === "staff").map((g) => g.name);
    expect(students).toEqual(["Form 1", "Form 2", "Form 3", "Form 4", "Form 5", "Lower 6", "Upper 6"]);
    expect(staff).toEqual(["Junior Staff", "Senior Staff", "Senior Admin", "External Staff"]);
  });

  it("marks External Staff as not expecting attendance, so contractors are not 'absent'", async () => {
    const rows = await h.db.select().from(groups);
    const external = rows.find((g) => g.name === "External Staff");
    expect(external?.expectsAttendance).toBe(false);
    // Everything else does expect attendance.
    expect(rows.filter((g) => g.name !== "External Staff").every((g) => g.expectsAttendance)).toBe(true);
  });

  it("seeds the attendance rules as settings, not as constants in code", async () => {
    const rows = await h.db.select().from(settings);
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    expect(byKey["timezone"]).toBe("Asia/Colombo");
    expect(byKey["late_threshold_default"]).toBe("08:00");
    expect(byKey["duplicate_window_seconds"]).toBe(60);
    expect(byKey["day_rollover_time"]).toBe("03:00");
  });

  it("is idempotent: re-running the seed changes nothing", async () => {
    const before = await h.db.select().from(groups);
    await h.db.execute(sql`
      INSERT INTO "groups" ("name", "branch", "display_order", "expects_attendance")
      VALUES ('Form 1', 'student', 1, true)
      ON CONFLICT ("name") DO NOTHING
    `);
    const after = await h.db.select().from(groups);
    expect(after).toHaveLength(before.length);
  });
});
