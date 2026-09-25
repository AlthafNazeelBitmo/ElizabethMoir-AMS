import { eq } from "drizzle-orm";
import type { LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  RegisterBroadcaster,
  isVisibleTo,
} from "../src/register/broadcaster.js";
import { decodeCursor, encodeCursor } from "../src/register/service.js";
import {
  calendarDays,
  dayRecords,
  groups,
  manualAdjustments,
  people,
  tutors,
} from "../src/db/schema/index.js";
import {
  createHarness,
  INGEST_TOKEN,
  login,
  seedUser,
  type LoggedIn,
  type TestHarness,
} from "./helpers/app.js";

const HEAD = "head@school.example";
const OFFICE = "office@school.example";
const DATE = "2026-09-16";
const AFTERNOON = new Date("2026-09-16T09:00:00.000Z"); // 14:30 Colombo

let h: TestHarness;
let full: LoggedIn;
let studentOnly: LoggedIn;
let formOneId: number;
let staffGroupId: number;

beforeAll(async () => {
  h = await createHarness({ now: AFTERNOON });
}, 60_000);

beforeEach(async () => {
  h.setNow(AFTERNOON);
  await h.db.truncateAll();
  await h.app.settings.invalidate();

  await seedUser(h, { email: HEAD, role: "full" });
  await seedUser(h, { email: OFFICE, role: "student_only" });

  const [form1] = await h.db.db
    .insert(groups)
    .values({ name: "Form 1", branch: "student", displayOrder: 1 })
    .returning();
  const [staff] = await h.db.db
    .insert(groups)
    .values({ name: "Junior Staff", branch: "staff", displayOrder: 1 })
    .returning();
  formOneId = form1!.id;
  staffGroupId = staff!.id;

  const [tutor] = await h.db.db
    .insert(tutors)
    .values({ initials: "AP" })
    .returning();
  await h.db.db.insert(people).values([
    {
      enrollNo: "11007",
      fullName: "Ann Perera",
      groupId: formOneId,
      tutorId: tutor!.id,
      // The school's code within the form: each form has its own pair.
      category: "DG",
    },
    {
      enrollNo: "11008",
      fullName: "Ben Silva",
      groupId: formOneId,
      tutorId: tutor!.id,
      category: "HP",
    },
    { enrollNo: "2001", fullName: "Cal Fernando", groupId: staffGroupId },
  ]);
  await h.db.db.insert(calendarDays).values({ date: DATE, type: "school_day" });

  full = await login(h, HEAD);
  studentOnly = await login(h, OFFICE);
});

afterAll(async () => {
  await h.close();
});

const get = (url: string, who: LoggedIn): Promise<LightMyRequestResponse> =>
  h.app.server.inject({ method: "GET", url, headers: { cookie: who.cookie } });

async function scan(enrollNo: string, attTime: string) {
  await h.app.server.inject({
    method: "POST",
    url: `/ingest/${INGEST_TOKEN}/raw`,
    headers: { "content-type": "application/json" },
    payload: JSON.stringify([
      {
        EmpId: enrollNo,
        AttTime: attTime,
        CheckingStatus: "0",
        DeviceID: "GATE-1",
      },
    ]),
  });
  await h.app.whenIdle();
  await h.app.processor.processPending();
}

describe("GET /api/register/live", () => {
  it("lists everyone expected, including those with no scans", async () => {
    const body = (await get(`/api/register/live?date=${DATE}`, full)).json();
    expect(body.rows).toHaveLength(3);
    expect(body.rows.map((r: { fullName: string }) => r.fullName)).toEqual([
      "Ann Perera",
      "Ben Silva",
      "Cal Fernando",
    ]);
  });

  it("shows someone who has scanned as on site, with their arrival", async () => {
    await scan("11007", "2026-09-16 07:30:00");
    const body = (await get(`/api/register/live?date=${DATE}`, full)).json();
    const ann = body.rows.find(
      (r: { enrollNo: string }) => r.enrollNo === "11007",
    );
    expect(ann.status).toBe("on_site");
    expect(ann.firstIn).toBe("2026-09-16T02:00:00.000Z");
  });

  it("says when each person last moved, for the register to put the latest first", async () => {
    // In, out at lunch, back: last_out is cleared by the return, so the
    // last movement is carried on its own. It travels on the stream too.
    const seen: Array<string | null> = [];
    h.app.broadcaster.subscribe("full", (p) => {
      if (p.event.type === "scan") seen.push(p.event.lastMovementAt);
    });
    await scan("11007", "2026-09-16 07:30:00");
    await scan("11007", "2026-09-16 12:00:00");
    await scan("11007", "2026-09-16 13:00:00");
    const body = (await get(`/api/register/live?date=${DATE}`, full)).json();
    const ann = body.rows.find(
      (r: { enrollNo: string }) => r.enrollNo === "11007",
    );
    expect(ann).toMatchObject({
      status: "on_site",
      firstIn: "2026-09-16T02:00:00.000Z",
      lastOut: null,
      lastMovementAt: "2026-09-16T07:30:00.000Z",
    });
    expect(seen.at(-1)).toBe("2026-09-16T07:30:00.000Z");
    const ben = body.rows.find(
      (r: { enrollNo: string }) => r.enrollNo === "11008",
    );
    expect(ben.lastMovementAt).toBeNull();
  });

  it("shows someone with no scans as absent once the day has started", async () => {
    const body = (await get(`/api/register/live?date=${DATE}`, full)).json();
    expect(
      body.rows.every((r: { status: string }) => r.status === "absent"),
    ).toBe(true);
  });

  it("does not mark anyone absent before the day has started", async () => {
    h.setNow(new Date("2026-09-15T22:00:00.000Z")); // 03:30 local, before 09:00
    const body = (await get(`/api/register/live?date=${DATE}`, full)).json();
    // Expected, not arrived, and not yet absent: pending — never "not
    // expected", which would say the opposite of the truth all morning.
    expect(
      body.rows.every((r: { status: string }) => r.status === "pending"),
    ).toBe(true);
    const summary = (await get(`/api/register/summary?date=${DATE}`, full)).json();
    expect(summary.counts).toMatchObject({ expected: 3, pending: 3, absent: 0, not_expected: 0 });
    // And the filter finds them.
    const waiting = (await get(`/api/register/live?date=${DATE}&status=pending`, full)).json();
    expect(waiting.rows).toHaveLength(3);
  });

  it("marks a member of staff late only against their group's own time", async () => {
    // The school's default hour is about its pupils. Until a staff group
    // is given a time, nobody in it is late; given one, they are.
    await scan("2001", `${DATE} 07:45:00`);
    const before = (await get(`/api/register/live?date=${DATE}`, full)).json();
    const cal = (r: { enrollNo: string }) => r.enrollNo === "2001";
    expect(before.rows.find(cal)).toMatchObject({ isLate: false });
    // The pupils are judged by the school's hour, as before.
    await scan("11007", `${DATE} 08:30:00`);
    const pupils = (await get(`/api/register/live?date=${DATE}`, full)).json();
    expect(
      pupils.rows.find((r: { enrollNo: string }) => r.enrollNo === "11007"),
    ).toMatchObject({ isLate: true });

    await h.db.db
      .update(groups)
      .set({ lateThreshold: "07:30" })
      .where(eq(groups.id, staffGroupId));
    await h.app.processor.recomputePersonDay("2001", DATE);
    const after = (await get(`/api/register/live?date=${DATE}`, full)).json();
    expect(after.rows.find(cal)).toMatchObject({ isLate: true });
  });

  it("says who left before their group's cut-off", async () => {
    await h.db.db
      .update(groups)
      .set({ leaveCutoff: "15:00" })
      .where(eq(groups.id, staffGroupId));
    await scan("2001", `${DATE} 07:45:00`);
    await scan("2001", `${DATE} 13:10:00`);
    const body = (await get(`/api/register/live?date=${DATE}`, full)).json();
    const cal = body.rows.find(
      (r: { enrollNo: string }) => r.enrollNo === "2001",
    );
    expect(cal).toMatchObject({ status: "departed", leftEarly: true });

    // A form with no cut-off has nobody leaving early.
    await scan("11007", `${DATE} 07:45:00`);
    await scan("11007", `${DATE} 13:10:00`);
    const pupils = (await get(`/api/register/live?date=${DATE}`, full)).json();
    expect(
      pupils.rows.find((r: { enrollNo: string }) => r.enrollNo === "11007"),
    ).toMatchObject({ status: "departed", leftEarly: false });
  });

  it("filters within a form by category, and says which are there to choose", async () => {
    const dg = (
      await get(
        `/api/register/live?date=${DATE}&group=${formOneId}&category=DG`,
        full,
      )
    ).json();
    expect(dg.rows.map((r: { enrollNo: string }) => r.enrollNo)).toEqual([
      "11007",
    ]);

    // The figures above the list follow it, so a printed sheet agrees
    // with itself.
    const summary = (
      await get(
        `/api/register/summary?date=${DATE}&group=${formOneId}&category=DG`,
        full,
      )
    ).json();
    expect(summary.counts).toMatchObject({ total: 1, expected: 1 });

    // The choices are the form's own, and do not collapse to the one
    // already chosen.
    expect(summary.categories).toEqual([
      { group: "Form 1", categories: ["DG", "HP"] },
    ]);
    const staffSide = (
      await get(`/api/register/summary?date=${DATE}&branch=staff`, full)
    ).json();
    expect(staffSide.categories).toEqual([]);
  });

  it("offers the categories under their group, in the school's order", async () => {
    // Alphabetically "Service" would come before Form 1's codes; the
    // school reads its forms first, then its staff.
    await h.db.db
      .update(people)
      .set({ category: "Service" })
      .where(eq(people.enrollNo, "2001"));
    const body = (await get(`/api/register/summary?date=${DATE}`, full)).json();
    expect(body.categories).toEqual([
      { group: "Form 1", categories: ["DG", "HP"] },
      { group: "Junior Staff", categories: ["Service"] },
    ]);
  });

  it("carries the group and tutor for each row", async () => {
    const body = (await get(`/api/register/live?date=${DATE}`, full)).json();
    const ann = body.rows.find(
      (r: { enrollNo: string }) => r.enrollNo === "11007",
    );
    expect(ann).toMatchObject({
      groupName: "Form 1",
      branch: "student",
      tutorInitials: "AP",
    });
  });

  it("filters by group, tutor, branch and search", async () => {
    const byGroup = (
      await get(`/api/register/live?date=${DATE}&group=${formOneId}`, full)
    ).json();
    expect(byGroup.rows).toHaveLength(2);

    const byBranch = (
      await get(`/api/register/live?date=${DATE}&branch=staff`, full)
    ).json();
    expect(byBranch.rows).toHaveLength(1);

    const byQuery = (
      await get(`/api/register/live?date=${DATE}&q=perera`, full)
    ).json();
    expect(byQuery.rows).toHaveLength(1);

    const byId = (
      await get(`/api/register/live?date=${DATE}&q=2001`, full)
    ).json();
    expect(byId.rows[0].fullName).toBe("Cal Fernando");
  });

  it("filters by status", async () => {
    await scan("11007", "2026-09-16 07:30:00");
    const onSite = (
      await get(`/api/register/live?date=${DATE}&status=on_site`, full)
    ).json();
    expect(onSite.rows).toHaveLength(1);
    expect(onSite.rows[0].enrollNo).toBe("11007");
  });

  it("lists people in the school's order, and pages along it", async () => {
    // Staff placed by the school come first among the staff, in that
    // order, whatever the alphabet says; the forms come before them.
    const [staff] = await h.db.db.select().from(groups).where(eq(groups.name, "Junior Staff"));
    await h.db.db.insert(people).values([
      { enrollNo: "2002", fullName: "Zara Head", groupId: staff!.id, displayOrder: 1 },
      { enrollNo: "2003", fullName: "Mark Deputy", groupId: staff!.id, displayOrder: 2 },
    ]);
    const all = (await get(`/api/register/live?date=${DATE}`, full)).json();
    expect(all.rows.map((r: { fullName: string }) => r.fullName)).toEqual([
      "Ann Perera",
      "Ben Silva",
      "Zara Head",
      "Mark Deputy",
      "Cal Fernando",
    ]);

    // The same order two at a time, without a gap or a repeat.
    const names: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 5; page++) {
      const body: { rows: Array<{ fullName: string }>; nextCursor: string | null } = (
        await get(
          `/api/register/live?date=${DATE}&limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
          full,
        )
      ).json();
      names.push(...body.rows.map((r: { fullName: string }) => r.fullName));
      cursor = body.nextCursor;
      if (!cursor) break;
    }
    expect(names).toEqual(["Ann Perera", "Ben Silva", "Zara Head", "Mark Deputy", "Cal Fernando"]);
  });

  it("pages with a stable cursor", async () => {
    const first = (
      await get(`/api/register/live?date=${DATE}&limit=2`, full)
    ).json();
    expect(first.rows).toHaveLength(2);
    expect(first.nextCursor).toEqual(expect.any(String));

    const second = (
      await get(
        `/api/register/live?date=${DATE}&limit=2&cursor=${encodeURIComponent(first.nextCursor)}`,
        full,
      )
    ).json();
    expect(second.rows).toHaveLength(1);
    expect(second.rows[0].fullName).toBe("Cal Fernando");
    expect(second.nextCursor).toBeNull();
  });

  it("rejects a page size above the maximum", async () => {
    expect(
      (await get(`/api/register/live?date=${DATE}&limit=500`, full)).statusCode,
    ).toBe(400);
  });

  it("rejects a malformed date", async () => {
    expect(
      (await get("/api/register/live?date=16-09-2026", full)).statusCode,
    ).toBe(400);
  });

  it("requires a session", async () => {
    const res = await h.app.server.inject({
      method: "GET",
      url: `/api/register/live?date=${DATE}`,
    });
    expect(res.statusCode).toBe(401);
  });
});

describe("role isolation on the register", () => {
  it("gives a student_only account no staff rows", async () => {
    const body = (
      await get(`/api/register/live?date=${DATE}`, studentOnly)
    ).json();
    expect(body.rows).toHaveLength(2);
    expect(
      body.rows.every((r: { branch: string }) => r.branch === "student"),
    ).toBe(true);
  });

  it("gives no staff rows even when staff is asked for by name", async () => {
    const body = (
      await get(`/api/register/live?date=${DATE}&q=Fernando`, studentOnly)
    ).json();
    expect(body.rows).toHaveLength(0);
  });

  it("gives no staff rows even when the staff group is named", async () => {
    const body = (
      await get(
        `/api/register/live?date=${DATE}&group=${staffGroupId}`,
        studentOnly,
      )
    ).json();
    expect(body.rows).toHaveLength(0);
  });

  it("gives no staff rows even when branch=staff is requested", async () => {
    const body = (
      await get(`/api/register/live?date=${DATE}&branch=staff`, studentOnly)
    ).json();
    expect(body.rows).toHaveLength(0);
  });

  it("counts only students in the summary", async () => {
    const body = (
      await get(`/api/register/summary?date=${DATE}`, studentOnly)
    ).json();
    expect(body.counts.total).toBe(2);
    expect(
      body.groups.every((g: { branch: string }) => g.branch === "student"),
    ).toBe(true);
  });

  it("404s a staff person fetched by id, rather than confirming they exist", async () => {
    const [cal] = await h.db.db
      .select()
      .from(people)
      .where(eq(people.enrollNo, "2001"));
    expect((await get(`/api/people/${cal!.id}`, studentOnly)).statusCode).toBe(
      404,
    );
    expect((await get(`/api/people/${cal!.id}`, full)).statusCode).toBe(200);
  });

  it("404s a staff person's scans", async () => {
    const [cal] = await h.db.db
      .select()
      .from(people)
      .where(eq(people.enrollNo, "2001"));
    const url = `/api/people/${cal!.id}/scans?from=${DATE}&to=${DATE}`;
    expect((await get(url, studentOnly)).statusCode).toBe(404);
  });
});

describe("GET /api/register/summary", () => {
  it("counts each status and the late flag separately", async () => {
    await scan("11007", "2026-09-16 07:30:00"); // on time
    await scan("11008", "2026-09-16 08:45:00"); // late
    const body = (await get(`/api/register/summary?date=${DATE}`, full)).json();
    expect(body.counts).toMatchObject({ total: 3, on_site: 2, absent: 1 });
    expect(body.counts.late).toBe(1);
  });

  it("counts who is in the building on a day nobody was expected", async () => {
    // A Sunday, or a day the calendar has not been given yet: the verdict
    // is "not expected", but the register is about who is here.
    const sunday = "2026-09-20";
    await scan("11007", "2026-09-20 09:00:00");
    await scan("11008", "2026-09-20 09:05:00");
    await scan("11008", "2026-09-20 12:00:00");
    const body = (await get(`/api/register/summary?date=${sunday}`, full)).json();
    expect(body.counts).toMatchObject({
      on_site: 1,
      departed: 1,
      absent: 0,
      not_expected: 3,
    });
    // The rail counts who has checked in — the same people the register
    // lists when it opens — not who is still on site.
    const form1 = body.groups.find((g: { name: string }) => g.name === "Form 1");
    expect(form1).toMatchObject({ total: 2, checkedIn: 2 });

    // The list's status filter speaks the same language as the counts.
    const inNow = (
      await get(`/api/register/live?date=${sunday}&status=on_site`, full)
    ).json();
    expect(inNow.rows.map((r: { enrollNo: string }) => r.enrollNo)).toEqual(["11007"]);
    const gone = (
      await get(`/api/register/live?date=${sunday}&status=departed`, full)
    ).json();
    expect(gone.rows.map((r: { enrollNo: string }) => r.enrollNo)).toEqual(["11008"]);
  });

  it("returns a live count for each group", async () => {
    await scan("11007", "2026-09-16 07:30:00");
    const body = (await get(`/api/register/summary?date=${DATE}`, full)).json();
    const form1 = body.groups.find(
      (g: { name: string }) => g.name === "Form 1",
    );
    expect(form1).toMatchObject({ total: 2, checkedIn: 1 });
  });

  it("lists groups in the school's display order, not alphabetically", async () => {
    const [form1] = await h.db.db
      .select()
      .from(groups)
      .where(eq(groups.name, "Form 1"));
    const [form10] = await h.db.db
      .insert(groups)
      .values({ name: "Form 10", branch: "student", displayOrder: 10 })
      .returning();
    const [form2] = await h.db.db
      .insert(groups)
      .values({ name: "Form 2", branch: "student", displayOrder: 2 })
      .returning();
    await h.db.db.insert(people).values([
      { enrollNo: "11101", fullName: "Ten", groupId: form10!.id },
      { enrollNo: "11102", fullName: "Two", groupId: form2!.id },
    ]);
    // Order the school's way: 1, 2, 10. Alphabetically it would be 1, 10, 2.
    await h.db.db
      .update(groups)
      .set({ displayOrder: 1 })
      .where(eq(groups.id, form1!.id));

    const body = (await get(`/api/register/summary?date=${DATE}`, full)).json();
    expect(
      body.groups
        .filter((g: { branch: string }) => g.branch === "student")
        .map((g: { name: string }) => g.name),
    ).toEqual(["Form 1", "Form 2", "Form 10"]);
  });

  it("shows a group with nobody in it yet as 0/0, not not at all", async () => {
    await h.db.db
      .insert(groups)
      .values({ name: "Form 9", branch: "student", displayOrder: 9 });
    const body = (await get(`/api/register/summary?date=${DATE}`, full)).json();
    const empty = body.groups.find((g: { name: string }) => g.name === "Form 9");
    expect(empty).toMatchObject({ checkedIn: 0, total: 0, branch: "student" });
  });

  it("keeps an empty staff group off a student-only account's rail", async () => {
    await h.db.db
      .insert(groups)
      .values({ name: "Senior Admin", branch: "staff", displayOrder: 9 });
    const body = (
      await get(`/api/register/summary?date=${DATE}`, studentOnly)
    ).json();
    expect(
      body.groups.some((g: { branch: string }) => g.branch === "staff"),
    ).toBe(false);
  });

  it("takes a deactivated group off the register, the rail and the counts, people and all", async () => {
    // Deactivating a group is how a whole group is taken off the register
    // until it is active again or its people are moved. They stay in the
    // directory meanwhile.
    await scan("11007", "2026-09-16 07:30:00");
    const [form1] = await h.db.db
      .select()
      .from(groups)
      .where(eq(groups.name, "Form 1"));
    await h.db.db
      .update(groups)
      .set({ isActive: false })
      .where(eq(groups.id, form1!.id));

    const summary = (
      await get(`/api/register/summary?date=${DATE}`, full)
    ).json();
    expect(summary.groups.some((g: { name: string }) => g.name === "Form 1")).toBe(false);
    expect(summary.counts).toMatchObject({ total: 1, on_site: 0 });
    const railTotal =
      summary.groups.reduce((n: number, g: { total: number }) => n + g.total, 0) +
      summary.ungrouped.total;
    expect(railTotal).toBe(summary.counts.total);

    const live = (await get(`/api/register/live?date=${DATE}`, full)).json();
    expect(live.rows.map((r: { enrollNo: string }) => r.enrollNo)).toEqual(["2001"]);

    // Still in the directory, so they can be moved or the group brought back.
    const listed = (await get("/api/admin/people?q=11007", full)).json();
    expect(listed.total).toBe(1);
  });

  it("counts the people in no group on their own line, so the rail adds up", async () => {
    await h.db.db.insert(people).values({ enrollNo: "70001", fullName: "Not Placed" });
    await scan("70001", "2026-09-16 07:40:00");
    const body = (await get(`/api/register/summary?date=${DATE}`, full)).json();
    expect(body.ungrouped).toEqual({ checkedIn: 1, total: 1 });
    const railTotal =
      body.groups.reduce((n: number, g: { total: number }) => n + g.total, 0) +
      body.ungrouped.total;
    expect(railTotal).toBe(body.counts.total);

    // The line is a filter, like any group.
    const live = (await get(`/api/register/live?date=${DATE}&group=none`, full)).json();
    expect(live.rows.map((r: { enrollNo: string }) => r.enrollNo)).toEqual(["70001"]);
    // A student-only account sees neither: no branch, no view.
    const theirs = (await get(`/api/register/summary?date=${DATE}`, studentOnly)).json();
    expect(theirs.ungrouped).toEqual({ checkedIn: 0, total: 0 });
  });

  it("says how many are expected today, apart from how many there are", async () => {
    // A school day: everyone in a group that expects attendance.
    const onDay = (await get(`/api/register/summary?date=${DATE}`, full)).json();
    expect(onDay.counts.expected).toBe(onDay.counts.total);
    // A Sunday: nobody, whatever the roll.
    const sunday = (await get(`/api/register/summary?date=2026-09-20`, full)).json();
    expect(sunday.counts.total).toBeGreaterThan(0);
    expect(sunday.counts.expected).toBe(0);
  });
});

describe("person detail", () => {
  it("returns the person and their day", async () => {
    await scan("11007", "2026-09-16 07:30:00");
    const [ann] = await h.db.db
      .select()
      .from(people)
      .where(eq(people.enrollNo, "11007"));
    const body = (await get(`/api/people/${ann!.id}`, full)).json();
    expect(body.person).toMatchObject({
      fullName: "Ann Perera",
      groupName: "Form 1",
    });
  });

  it("returns the timeline of scans and the recent days", async () => {
    await scan("11007", "2026-09-16 07:30:00");
    await scan("11007", "2026-09-16 15:00:00");
    const [ann] = await h.db.db
      .select()
      .from(people)
      .where(eq(people.enrollNo, "11007"));
    const body = (
      await get(`/api/people/${ann!.id}/scans?from=${DATE}&to=${DATE}`, full)
    ).json();
    expect(body.scans).toHaveLength(2);
    expect(body.scans.map((s: { direction: string }) => s.direction)).toEqual([
      "in",
      "out",
    ]);
    expect(body.days).toHaveLength(1);
  });
});

describe("manual adjustment", () => {
  async function aDayRecord() {
    await scan("11007", "2026-09-16 07:30:00");
    const [record] = await h.db.db.select().from(dayRecords);
    return record!;
  }

  const patch = (id: number, payload: unknown, who: LoggedIn = full) =>
    h.app.server.inject({
      method: "PATCH",
      url: `/api/day-records/${id}`,
      payload: payload as never,
      headers: { cookie: who.cookie, "x-csrf-token": who.csrfToken },
    });

  it("refuses a change with no reason", async () => {
    const record = await aDayRecord();
    const res = await patch(record.id, { status: "departed" });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/reason/i);
  });

  it("refuses a reason that says nothing", async () => {
    const record = await aDayRecord();
    expect(
      (await patch(record.id, { status: "departed", reason: "x" })).statusCode,
    ).toBe(400);
  });

  it("applies the change and marks the day as edited", async () => {
    const record = await aDayRecord();
    const res = await patch(record.id, {
      status: "departed",
      reason: "Signed out at reception, reader missed it.",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().dayRecord).toMatchObject({
      status: "departed",
      hasManualEdit: true,
    });
  });

  it("records who changed it, what, and why", async () => {
    const record = await aDayRecord();
    await patch(record.id, {
      status: "departed",
      reason: "Signed out at reception, reader missed it.",
    });
    const body = (
      await get(`/api/day-records/${record.id}/adjustments`, full)
    ).json();
    expect(body.adjustments).toHaveLength(1);
    expect(body.adjustments[0]).toMatchObject({
      field: "status",
      newValue: "departed",
      reason: "Signed out at reception, reader missed it.",
      byName: "head",
    });
  });

  it("survives a later recomputation", async () => {
    const record = await aDayRecord();
    await patch(record.id, {
      status: "departed",
      reason: "Corrected by the office.",
    });
    await scan("11007", "2026-09-16 16:00:00");
    const [after] = await h.db.db
      .select()
      .from(dayRecords)
      .where(eq(dayRecords.id, record.id));
    expect(after?.status).toBe("departed");
  });

  it("stores an adjustment row per field changed", async () => {
    const record = await aDayRecord();
    await patch(record.id, {
      status: "departed",
      lastOut: "2026-09-16T09:30:00.000Z",
      reason: "Left early for an appointment.",
    });
    const rows = await h.db.db.select().from(manualAdjustments);
    expect(rows.map((r) => r.field).sort()).toEqual(["last_out", "status"]);
  });

  it("refuses a student_only account any correction, even of a student's day", async () => {
    // Overriding what the readers said is an administrator's act.
    const own = await aDayRecord();
    expect(
      (
        await patch(
          own.id,
          { status: "departed", reason: "Should not work." },
          studentOnly,
        )
      ).statusCode,
    ).toBe(403);

    await scan("2001", "2026-09-16 07:30:00");
    const [staffDay] = await h.db.db
      .select()
      .from(dayRecords)
      .where(eq(dayRecords.personId, (await h.db.db.select().from(people).where(eq(people.enrollNo, "2001")))[0]!.id));
    expect(
      (
        await patch(
          staffDay!.id,
          { status: "departed", reason: "Should not work." },
          studentOnly,
        )
      ).statusCode,
    ).toBe(403);
  });

  it("moves a time, and the register reads the moved time", async () => {
    const record = await aDayRecord();
    const res = await patch(record.id, {
      firstIn: "2026-09-16T01:45:00.000Z",
      lastOut: "2026-09-16T09:30:00.000Z",
      status: "departed",
      reason: "Signed in at reception; the reader was down.",
    });
    expect(res.statusCode).toBe(200);
    const live = (
      await h.app.server.inject({
        method: "GET",
        url: "/api/register/live?date=2026-09-16",
        headers: { cookie: full.cookie },
      })
    ).json();
    const row = live.rows.find((r: { enrollNo: string }) => r.enrollNo === "11007");
    expect(row).toMatchObject({
      firstIn: "2026-09-16T01:45:00.000Z",
      lastOut: "2026-09-16T09:30:00.000Z",
      status: "departed",
      hasManualEdit: true,
      // A time set by hand takes its place in the order as a scan would.
      lastMovementAt: "2026-09-16T09:30:00.000Z",
    });
  });
});

describe("the broadcaster", () => {
  it("hands out monotonic ids", () => {
    const b = new RegisterBroadcaster();
    const a = b.publish(event("student"));
    const c = b.publish(event("student"));
    expect(c.id).toBe(a.id + 1);
    expect(b.lastEventId).toBe(c.id);
  });

  it("never delivers a staff event to a student_only subscriber", () => {
    const b = new RegisterBroadcaster();
    const seen: string[] = [];
    b.subscribe("student_only", (p) =>
      seen.push((p.event as { personId: string }).personId),
    );
    b.publish(event("staff", "staff-person"));
    b.publish(event("student", "student-person"));
    expect(seen).toEqual(["student-person"]);
  });

  it("delivers both branches to a full subscriber", () => {
    const b = new RegisterBroadcaster();
    const seen: string[] = [];
    b.subscribe("full", (p) =>
      seen.push((p.event as { personId: string }).personId),
    );
    b.publish(event("staff", "staff-person"));
    b.publish(event("student", "student-person"));
    expect(seen).toEqual(["staff-person", "student-person"]);
  });

  it("hides a person with no branch from a student_only subscriber", () => {
    // Matches the register query, which excludes the ungrouped for the same
    // reason: they might be staff.
    expect(isVisibleTo(event(null), "student_only")).toBe(false);
    expect(isVisibleTo(event(null), "full")).toBe(true);
  });

  it("replays what a reconnecting client missed", () => {
    const b = new RegisterBroadcaster();
    const first = b.publish(event("student", "a"));
    b.publish(event("student", "b"));
    const missed = b.replay(first.id, "full");
    expect(
      missed?.map((p) => (p.event as { personId: string }).personId),
    ).toEqual(["b"]);
  });

  it("filters the replay by role too", () => {
    const b = new RegisterBroadcaster();
    const first = b.publish(event("student", "a"));
    b.publish(event("staff", "s"));
    b.publish(event("student", "b"));
    const missed = b.replay(first.id, "student_only");
    expect(
      missed?.map((p) => (p.event as { personId: string }).personId),
    ).toEqual(["b"]);
  });

  it("says so rather than lying when the gap is too large to fill", () => {
    const b = new RegisterBroadcaster();
    for (let i = 0; i < 600; i++) b.publish(event("student"));
    // Asking from the very beginning, long since dropped from the buffer.
    expect(b.replay(1, "full")).toBeNull();
  });

  it("stops delivering after unsubscribe", () => {
    const b = new RegisterBroadcaster();
    let count = 0;
    const off = b.subscribe("full", () => count++);
    b.publish(event("student"));
    off();
    b.publish(event("student"));
    expect(count).toBe(1);
  });

  it("keeps delivering to others when one subscriber throws", () => {
    const b = new RegisterBroadcaster();
    let delivered = 0;
    b.subscribe("full", () => {
      throw new Error("broken pipe");
    });
    b.subscribe("full", () => delivered++);
    b.publish(event("student"));
    expect(delivered).toBe(1);
  });

  function event(branch: "student" | "staff" | null, personId = "p1") {
    return {
      type: "scan" as const,
      personId,
      fullName: "Someone",
      enrollNo: "1",
      branch,
      groupId: null,
      groupName: null,
      tutorInitials: null,
      date: DATE,
      firstIn: null,
      lastOut: null,
      lastMovementAt: null,
      status: "on_site" as const,
      isLate: false,
      leftEarly: false,
      hasManualEdit: false,
      scanCount: 1,
    };
  }
});

describe("cursors", () => {
  it("round-trip", () => {
    const cursor = {
      groupOrder: 1,
      personOrder: 2147483647,
      fullName: "Ann Perera",
      personId: "abc-123",
    };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it("treats a cursor from before the school's order as no cursor", () => {
    const old = Buffer.from(JSON.stringify(["Ann Perera", "abc-123"])).toString("base64url");
    expect(decodeCursor(old)).toBeNull();
  });

  it("treats a malformed cursor as no cursor, since it is usually a stale bookmark", () => {
    expect(decodeCursor("not-a-cursor")).toBeNull();
    expect(decodeCursor("")).toBeNull();
  });
});

describe("the broadcaster's identity", () => {
  it("differs between processes and is stable within one", () => {
    const a = new RegisterBroadcaster();
    const b = new RegisterBroadcaster();
    expect(a.instanceId).toMatch(/^[0-9a-f]{12}$/);
    expect(a.instanceId).not.toBe(b.instanceId);
    expect(a.instanceId).toBe(a.instanceId);
  });
});

describe("the live stream publishes a scan", () => {
  it("announces the person's new day state", async () => {
    const seen: Array<{ personId: string; status: string }> = [];
    h.app.broadcaster.subscribe("full", (p) => {
      if (p.event.type === "scan")
        seen.push({ personId: p.event.personId, status: p.event.status });
    });

    await scan("11007", "2026-09-16 07:30:00");

    expect(seen).toHaveLength(1);
    expect(seen[0]?.status).toBe("on_site");
    const [ann] = await h.db.db
      .select()
      .from(people)
      .where(eq(people.enrollNo, "11007"));
    expect(seen[0]?.personId).toBe(ann!.id);
  });

  it("does not announce a staff scan to a student_only subscriber", async () => {
    const seen: string[] = [];
    h.app.broadcaster.subscribe("student_only", (p) => {
      if (p.event.type === "scan") seen.push(p.event.enrollNo);
    });
    await scan("2001", "2026-09-16 07:30:00");
    expect(seen).toHaveLength(0);
  });
});
