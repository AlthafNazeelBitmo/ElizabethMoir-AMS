import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  branchFilter,
  canSeeStaff,
  visibleBranches,
} from "../src/auth/scope.js";
import { groups, people, type UserRole } from "../src/db/schema/index.js";
import {
  createHarness,
  login,
  seedDirectory,
  seedUser,
  type TestHarness,
} from "./helpers/app.js";

/**
 * Specification §9: "A `student_only` user must not be able to obtain a
 * single staff record from any endpoint, by any parameter, in any export,
 * ever", and the filter must be applied in the database query rather than in
 * a response mapper.
 *
 * Endpoints that serve people arrive in later phases. What is tested here is
 * the mechanism those endpoints are required to use — against real rows in a
 * real database, including the cases that a response-mapper approach would
 * silently get wrong: counts, aggregates, and lookups by id.
 */
let h: TestHarness;

const HEAD = "head@school.example";
const OFFICE = "office@school.example";

beforeAll(async () => {
  h = await createHarness();
}, 60_000);

beforeEach(async () => {
  await h.db.truncateAll();
  await seedUser(h, { email: HEAD, role: "full" });
  await seedUser(h, { email: OFFICE, role: "student_only" });
  await seedDirectory(h);
});

afterAll(async () => {
  await h.close();
});

/** The query shape every people-serving endpoint is required to use. */
function visiblePeople(role: UserRole, extra?: ReturnType<typeof eq>) {
  return h.db.db
    .select({ id: people.id, fullName: people.fullName, branch: groups.branch })
    .from(people)
    .leftJoin(groups, eq(groups.id, people.groupId))
    .where(and(branchFilter(role), extra));
}

describe("visibleBranches", () => {
  it("gives a full user both branches", () => {
    expect(visibleBranches("full")).toEqual(["student", "staff"]);
    expect(canSeeStaff("full")).toBe(true);
  });

  it("gives a student_only user the student branch alone", () => {
    expect(visibleBranches("student_only")).toEqual(["student"]);
    expect(canSeeStaff("student_only")).toBe(false);
  });
});

describe("a student_only query", () => {
  it("returns zero staff rows", async () => {
    const rows = await visiblePeople("student_only");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.filter((r) => r.branch === "staff")).toHaveLength(0);
    expect(rows.every((r) => r.branch === "student")).toBe(true);
  });

  it("excludes people with no group, because an unclassified person may be staff", async () => {
    const rows = await visiblePeople("student_only");
    expect(rows.map((r) => r.fullName)).not.toContain("Unclassified Person");
  });

  it("cannot reach a staff member by asking for them by id", async () => {
    const [staff] = await h.db.db
      .select({ id: people.id })
      .from(people)
      .where(eq(people.enrollNo, "2001"));

    // The filter is composed into the query, so naming the row directly
    // still returns nothing. A response mapper would have fetched it first.
    const asStudentOnly = await visiblePeople(
      "student_only",
      eq(people.id, staff!.id),
    );
    expect(asStudentOnly).toHaveLength(0);

    const asFull = await visiblePeople("full", eq(people.id, staff!.id));
    expect(asFull).toHaveLength(1);
  });

  it("cannot reach a staff member by naming their group", async () => {
    const [staffGroup] = await h.db.db
      .select({ id: groups.id })
      .from(groups)
      .where(eq(groups.branch, "staff"));
    const rows = await visiblePeople(
      "student_only",
      eq(people.groupId, staffGroup!.id),
    );
    expect(rows).toHaveLength(0);
  });

  it("counts only students, so an aggregate cannot leak the staff headcount", async () => {
    const countFor = async (role: UserRole) => {
      const [row] = await h.db.db
        .select({ n: sql<number>`count(*)::int` })
        .from(people)
        .leftJoin(groups, eq(groups.id, people.groupId))
        .where(branchFilter(role));
      return row?.n ?? 0;
    };
    // Seeded: 2 students, 1 staff, 1 unclassified.
    expect(await countFor("student_only")).toBe(2);
    expect(await countFor("full")).toBe(4);
  });

  it("stays correct when a person is moved into the staff branch", async () => {
    const [staffGroup] = await h.db.db
      .select({ id: groups.id })
      .from(groups)
      .where(eq(groups.branch, "staff"));
    await h.db.db
      .update(people)
      .set({ groupId: staffGroup!.id })
      .where(eq(people.enrollNo, "11007"));

    const rows = await visiblePeople("student_only");
    expect(rows.map((r) => r.fullName)).not.toContain("A Student");
  });
});

describe("a full query", () => {
  it("returns both branches and ungrouped people", async () => {
    const rows = await visiblePeople("full");
    const branches = new Set(rows.map((r) => r.branch));
    expect(branches).toContain("student");
    expect(branches).toContain("staff");
    expect(rows.map((r) => r.fullName)).toContain("Unclassified Person");
  });

  it("applies no predicate at all", () => {
    expect(branchFilter("full")).toBeUndefined();
  });
});

describe("both roles can sign in", () => {
  it("admits the full account", async () => {
    const { body } = await login(h, HEAD);
    expect((body["user"] as { role: string }).role).toBe("full");
  });

  it("admits the student_only account", async () => {
    const { body } = await login(h, OFFICE);
    expect((body["user"] as { role: string }).role).toBe("student_only");
  });
});
