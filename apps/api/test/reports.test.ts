import { eq, sql } from "drizzle-orm";
import type { LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { attendanceReportToCsv, csvField } from "../src/reports/csv.js";
import {
  formatArrival,
  type AttendanceReport,
} from "../src/reports/service.js";
import {
  auditLog,
  calendarDays,
  dayRecords,
  groups,
  people,
  scans,
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

/** Monday to Friday of one week, plus the weekend either side. */
const WEEK = [
  "2026-09-14",
  "2026-09-15",
  "2026-09-16",
  "2026-09-17",
  "2026-09-18",
];
const FROM = "2026-09-14";
const TO = "2026-09-20";

/** Late in the day, so absence has been decided for every seeded date. */
const NOW = new Date("2026-09-20T12:00:00.000Z");

let h: TestHarness;
let full: LoggedIn;
let studentOnly: LoggedIn;
let formOneId: number;
let staffGroupId: number;

beforeAll(async () => {
  h = await createHarness({ now: NOW });
}, 60_000);

beforeEach(async () => {
  h.setNow(NOW);
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
    },
    {
      enrollNo: "11008",
      fullName: "Ben Silva",
      groupId: formOneId,
      tutorId: tutor!.id,
    },
    { enrollNo: "2001", fullName: "Cal Fernando", groupId: staffGroupId },
  ]);

  await h.db.db
    .insert(calendarDays)
    .values([
      ...WEEK.map((date) => ({ date, type: "school_day" as const })),
      { date: "2026-09-19", type: "weekend" as const },
      { date: "2026-09-20", type: "weekend" as const },
    ]);

  full = await login(h, HEAD);
  studentOnly = await login(h, OFFICE);
});

afterAll(async () => {
  await h.close();
});

const get = (
  url: string,
  who: LoggedIn = full,
): Promise<LightMyRequestResponse> =>
  h.app.server.inject({ method: "GET", url, headers: { cookie: who.cookie } });

async function scan(enrollNo: string, attTimeLocal: string) {
  await h.app.server.inject({
    method: "POST",
    url: `/ingest/${INGEST_TOKEN}/raw`,
    headers: { "content-type": "application/json" },
    payload: JSON.stringify([
      {
        EmpId: enrollNo,
        AttTime: attTimeLocal,
        CheckingStatus: "0",
        DeviceID: "GATE-1",
      },
    ]),
  });
  await h.app.whenIdle();
  await h.app.processor.processPending();
}

/** Ann attends Mon–Wed (Wed late), is absent Thu–Fri. Ben attends all week. */
async function seedAWeek() {
  await scan("11007", "2026-09-14 07:30:00");
  await scan("11007", "2026-09-15 07:40:00");
  await scan("11007", "2026-09-16 08:50:00"); // late
  for (const date of WEEK) await scan("11008", `${date} 07:50:00`);
  // Absences are materialised by the scheduled job, not by a scan — nobody
  // scanned, so nothing would otherwise trigger a computation for them.
  for (const date of WEEK) await h.app.processor.markAbsences(date);
}

describe("GET /api/reports/attendance", () => {
  it("counts present, absent and late days per person", async () => {
    await seedAWeek();
    const report: AttendanceReport = (
      await get(`/api/reports/attendance?from=${FROM}&to=${TO}`)
    ).json();

    const ann = report.rows.find((r) => r.enrollNo === "11007")!;
    expect(ann.daysPresent).toBe(3);
    expect(ann.daysAbsent).toBe(2);
    expect(ann.daysExpected).toBe(5);
    expect(ann.lateCount).toBe(1);
    expect(ann.attendancePercentage).toBe(60);

    const ben = report.rows.find((r) => r.enrollNo === "11008")!;
    expect(ben.daysPresent).toBe(5);
    expect(ben.attendancePercentage).toBe(100);
  });

  it("averages arrival over the days they actually arrived", async () => {
    await seedAWeek();
    const report: AttendanceReport = (
      await get(`/api/reports/attendance?from=${FROM}&to=${TO}`)
    ).json();
    const ann = report.rows.find((r) => r.enrollNo === "11007")!;
    // 07:30, 07:40, 08:50 local → mean 08:00.
    expect(formatArrival(ann.averageArrivalSeconds)).toBe("08:00");
    const ben = report.rows.find((r) => r.enrollNo === "11008")!;
    expect(formatArrival(ben.averageArrivalSeconds)).toBe("07:50");
  });

  it("includes someone with no records at all, rather than dropping them", async () => {
    const report: AttendanceReport = (
      await get(`/api/reports/attendance?from=${FROM}&to=${TO}`)
    ).json();
    const cal = report.rows.find((r) => r.enrollNo === "2001")!;
    expect(cal.daysPresent).toBe(0);
    expect(cal.daysExpected).toBe(0);
    // No denominator means no percentage, not zero percent.
    expect(cal.attendancePercentage).toBeNull();
    expect(cal.averageArrivalSeconds).toBeNull();
  });

  it("counts the school days in the range", async () => {
    const report: AttendanceReport = (
      await get(`/api/reports/attendance?from=${FROM}&to=${TO}`)
    ).json();
    expect(report.schoolDaysInRange).toBe(5);
  });

  it("gives an aggregate row weighted by days, not a mean of means", async () => {
    await seedAWeek();
    const report: AttendanceReport = (
      await get(`/api/reports/attendance?from=${FROM}&to=${TO}`)
    ).json();
    // Ann present 3 of 5, Ben 5 of 5, and Cal — a staff member who never
    // scanned — absent all five. Eight present against fifteen expected.
    expect(report.totals.daysPresent).toBe(8);
    expect(report.totals.daysAbsent).toBe(7);
    expect(report.totals.daysExpected).toBe(15);
    expect(report.totals.attendancePercentage).toBe(53.3);
    // Ann averaged 08:00 over 3 days, Ben 07:50 over 5 — weighted 07:53:45.
    expect(formatArrival(report.totals.averageArrivalSeconds)).toBe("07:54");
  });

  it("filters by group, branch and tutor", async () => {
    await seedAWeek();
    const byGroup: AttendanceReport = (
      await get(
        `/api/reports/attendance?from=${FROM}&to=${TO}&group=${formOneId}`,
      )
    ).json();
    expect(byGroup.rows).toHaveLength(2);

    const byBranch: AttendanceReport = (
      await get(`/api/reports/attendance?from=${FROM}&to=${TO}&branch=staff`)
    ).json();
    expect(byBranch.rows.map((r) => r.enrollNo)).toEqual(["2001"]);
  });

  it("rejects a reversed range and one that is absurdly long", async () => {
    expect(
      (await get(`/api/reports/attendance?from=${TO}&to=${FROM}`)).statusCode,
    ).toBe(400);
    expect(
      (await get("/api/reports/attendance?from=2020-01-01&to=2026-01-01"))
        .statusCode,
    ).toBe(400);
  });

  it("requires a session", async () => {
    const res = await h.app.server.inject({
      method: "GET",
      url: `/api/reports/attendance?from=${FROM}&to=${TO}`,
    });
    expect(res.statusCode).toBe(401);
  });
});

describe("the figures reconcile against the raw scans", () => {
  // This is the gate for the phase: the report is several derivations away
  // from the feed, so it is checked against the rows underneath it rather
  // than against itself.
  it("present days equal the days that have an arrival scan", async () => {
    await seedAWeek();
    const report: AttendanceReport = (
      await get(`/api/reports/attendance?from=${FROM}&to=${TO}`)
    ).json();

    for (const row of report.rows) {
      const distinctScanDays = await h.db.db
        .select({ n: sql<number>`count(distinct (att_time_local::date))::int` })
        .from(scans)
        .where(eq(scans.enrollNo, row.enrollNo));
      expect(
        row.daysPresent,
        `${row.fullName} has ${row.daysPresent} present days but scans on ${distinctScanDays[0]?.n} days`,
      ).toBe(Number(distinctScanDays[0]?.n ?? 0));
    }
  });

  it("present plus absent equals the day records that expected them", async () => {
    await seedAWeek();
    const report: AttendanceReport = (
      await get(`/api/reports/attendance?from=${FROM}&to=${TO}`)
    ).json();

    for (const row of report.rows) {
      const [counted] = await h.db.db
        .select({ n: sql<number>`count(*)::int` })
        .from(dayRecords)
        .where(
          sql`${dayRecords.personId} = ${row.personId}
              and ${dayRecords.date} between ${FROM} and ${TO}
              and ${dayRecords.status} in ('on_site', 'departed', 'absent')`,
        );
      expect(row.daysExpected).toBe(Number(counted?.n ?? 0));
    }
  });

  it("late days equal the day records flagged late", async () => {
    await seedAWeek();
    const report: AttendanceReport = (
      await get(`/api/reports/attendance?from=${FROM}&to=${TO}`)
    ).json();
    const [flagged] = await h.db.db
      .select({ n: sql<number>`count(*)::int` })
      .from(dayRecords)
      .where(eq(dayRecords.isLate, true));
    expect(report.totals.lateCount).toBe(Number(flagged?.n ?? 0));
  });

  it("no day outside the range is counted", async () => {
    await seedAWeek();
    // A scan well before the range must not move the figures.
    await scan("11007", "2026-08-03 07:30:00");
    const report: AttendanceReport = (
      await get(`/api/reports/attendance?from=${FROM}&to=${TO}`)
    ).json();
    expect(report.rows.find((r) => r.enrollNo === "11007")!.daysPresent).toBe(
      3,
    );
  });

  it("a not_expected day moves nothing", async () => {
    await seedAWeek();
    // The weekend: a scan on it produces a not_expected record.
    await scan("11007", "2026-09-19 10:00:00");
    const report: AttendanceReport = (
      await get(`/api/reports/attendance?from=${FROM}&to=${TO}`)
    ).json();
    const ann = report.rows.find((r) => r.enrollNo === "11007")!;
    expect(ann.daysExpected).toBe(5);
    expect(ann.attendancePercentage).toBe(60);
  });
});

describe("role isolation on reports", () => {
  it("gives a student_only account no staff rows", async () => {
    await seedAWeek();
    const report: AttendanceReport = (
      await get(`/api/reports/attendance?from=${FROM}&to=${TO}`, studentOnly)
    ).json();
    expect(report.rows.map((r) => r.enrollNo).sort()).toEqual([
      "11007",
      "11008",
    ]);
  });

  it("gives no staff rows even when branch=staff is asked for", async () => {
    const report: AttendanceReport = (
      await get(
        `/api/reports/attendance?from=${FROM}&to=${TO}&branch=staff`,
        studentOnly,
      )
    ).json();
    expect(report.rows).toHaveLength(0);
    expect(report.totals.people).toBe(0);
  });

  it("keeps a staff member out of the CSV export too", async () => {
    await seedAWeek();
    const res = await get(
      `/api/reports/attendance?from=${FROM}&to=${TO}&format=csv`,
      studentOnly,
    );
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain("Cal Fernando");
    expect(res.body).toContain("Ann Perera");
  });

  it("404s a staff member's per-person report", async () => {
    const [cal] = await h.db.db
      .select()
      .from(people)
      .where(eq(people.enrollNo, "2001"));
    const url = `/api/reports/person/${cal!.id}?from=${FROM}&to=${TO}`;
    expect((await get(url, studentOnly)).statusCode).toBe(404);
    expect((await get(url, full)).statusCode).toBe(200);
  });
});

describe("GET /api/reports/person/:id", () => {
  async function annId(): Promise<string> {
    const [ann] = await h.db.db
      .select()
      .from(people)
      .where(eq(people.enrollNo, "11007"));
    return ann!.id;
  }

  it("agrees with the school-wide report to the digit", async () => {
    await seedAWeek();
    const id = await annId();
    const person = (
      await get(`/api/reports/person/${id}?from=${FROM}&to=${TO}`)
    ).json();
    const whole: AttendanceReport = (
      await get(`/api/reports/attendance?from=${FROM}&to=${TO}`)
    ).json();

    expect(person.person.enrollNo).toBe("11007");
    expect(person.from).toBe(FROM);
    expect(person.to).toBe(TO);
    expect(person.schoolDaysInRange).toBe(5);
    expect(person.summary).toEqual(
      whole.rows.find((r) => r.enrollNo === "11007"),
    );
    expect(person.days).toHaveLength(5);
    // Nobody tapped out, so each present day stays "on site" — the system
    // does not invent a departure it never saw.
    expect(person.days.map((d: { status: string }) => d.status)).toEqual([
      "on_site",
      "on_site",
      "on_site",
      "absent",
      "absent",
    ]);
  });

  it("exports one person's days as CSV, named by number rather than by name", async () => {
    await seedAWeek();
    const id = await annId();
    const res = await get(
      `/api/reports/person/${id}?from=${FROM}&to=${TO}&format=csv`,
    );
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
    expect(res.headers["content-disposition"]).toContain(
      `attendance-11007-${FROM}-to-${TO}.csv`,
    );
    expect(res.headers["content-disposition"]).not.toContain("Ann");

    expect(res.body).toContain('"Ann Perera","11007"');
    expect(res.body).toContain("School days in range: 5");
    expect(res.body).toContain("Present 3");
    // The school's wall clock, not UTC: 07:30 Colombo is 02:00 UTC.
    expect(res.body).toContain('"2026-09-14","on_site","07:30"');
    expect(res.body).toContain('"2026-09-16","on_site","08:50","","yes"');
    expect(res.body).toContain('"2026-09-17","absent",""');

    const entries = await h.db.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, "report_export"));
    expect(entries).toHaveLength(1);
    expect(entries[0]!.entity).toBe("person_report");
  });

  it("refuses a range that is too long, like the main report", async () => {
    const id = await annId();
    const res = await get(
      `/api/reports/person/${id}?from=2020-01-01&to=2026-09-20`,
    );
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("range_too_long");
  });
});

describe("CSV export", () => {
  it("is served as a download with a descriptive filename", async () => {
    await seedAWeek();
    const res = await get(
      `/api/reports/attendance?from=${FROM}&to=${TO}&format=csv`,
    );
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
    expect(res.headers["content-disposition"]).toContain(
      `attendance-${FROM}-to-${TO}.csv`,
    );
  });

  it("explains itself: range, filters and school days", async () => {
    await seedAWeek();
    const res = await get(
      `/api/reports/attendance?from=${FROM}&to=${TO}&group=${formOneId}&format=csv`,
    );
    expect(res.body).toContain(`${FROM} to ${TO}`);
    expect(res.body).toContain("Group: Form 1");
    expect(res.body).toContain("School days in range: 5");
  });

  it("carries the aggregate row and every person", async () => {
    await seedAWeek();
    const res = await get(
      `/api/reports/attendance?from=${FROM}&to=${TO}&format=csv`,
    );
    expect(res.body).toContain("All 3 people");
    expect(res.body).toContain("Ann Perera");
    expect(res.body).toContain("Ben Silva");
  });

  it("is audited, because an export leaves the building", async () => {
    await seedAWeek();
    await get(`/api/reports/attendance?from=${FROM}&to=${TO}&format=csv`);
    const entries = await h.db.db.select().from(auditLog);
    const actions = entries.map((e) => e.action);
    expect(actions).toContain("report_export");
  });

  it("does not audit a plain JSON read", async () => {
    await get(`/api/reports/attendance?from=${FROM}&to=${TO}`);
    const entries = await h.db.db.select().from(auditLog);
    const actions = entries.map((e) => e.action);
    expect(actions).not.toContain("report_export");
  });
});

describe("csvField", () => {
  it("quotes every value", () => {
    expect(csvField("plain")).toBe('"plain"');
    expect(csvField(42)).toBe('"42"');
  });

  it("keeps a comma inside a name from shifting every later column", () => {
    expect(csvField("Perera, Ann")).toBe('"Perera, Ann"');
  });

  it("doubles embedded quotes", () => {
    expect(csvField('She said "hello"')).toBe('"She said ""hello"""');
  });

  it("defuses a value a spreadsheet would run as a formula", () => {
    // Names come from an uploaded file and IDs from an unauthenticated
    // webhook, so neither is trusted enough to hand over unescaped.
    expect(csvField("=1+1")).toBe('"\'=1+1"');
    expect(csvField("+44 77")).toBe('"\'+44 77"');
    expect(csvField("-2")).toBe('"\'-2"');
    expect(csvField("@SUM(A1)")).toBe('"\'@SUM(A1)"');
  });

  it("renders null and undefined as empty, not as the word null", () => {
    expect(csvField(null)).toBe('""');
    expect(csvField(undefined)).toBe('""');
  });
});

describe("attendanceReportToCsv", () => {
  const report: AttendanceReport = {
    from: "2026-09-14",
    to: "2026-09-18",
    schoolDaysInRange: 5,
    rows: [
      {
        personId: "p1",
        enrollNo: "11007",
        fullName: "Perera, Ann",
        groupName: "Form 1",
        branch: "student",
        tutorInitials: "AP",
        daysPresent: 3,
        daysAbsent: 2,
        daysExpected: 5,
        lateCount: 1,
        attendancePercentage: 60,
        averageArrivalSeconds: 28_800,
      },
    ],
    totals: {
      people: 1,
      daysPresent: 3,
      daysAbsent: 2,
      daysExpected: 5,
      lateCount: 1,
      attendancePercentage: 60,
      averageArrivalSeconds: 28_800,
    },
  };

  it("starts with a byte-order mark so a spreadsheet reads names correctly", () => {
    const csv = attendanceReportToCsv(report, {
      filtersDescription: "No filters applied",
      generatedAt: new Date("2026-09-20T12:00:00Z"),
    });
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain("\r\n");
  });

  it("keeps a name containing a comma in one cell", () => {
    const csv = attendanceReportToCsv(report, {
      filtersDescription: "No filters applied",
      generatedAt: new Date(),
    });
    expect(csv).toContain('"Perera, Ann"');
  });

  it("formats the average arrival as a time", () => {
    const csv = attendanceReportToCsv(report, {
      filtersDescription: "No filters applied",
      generatedAt: new Date(),
    });
    expect(csv).toContain('"08:00"');
  });
});

describe("formatArrival", () => {
  it("renders seconds after midnight as a wall-clock time", () => {
    expect(formatArrival(0)).toBe("00:00");
    expect(formatArrival(27_000)).toBe("07:30");
    expect(formatArrival(28_800)).toBe("08:00");
  });

  it("renders nothing when there is nothing to average", () => {
    expect(formatArrival(null)).toBe("");
  });
});
