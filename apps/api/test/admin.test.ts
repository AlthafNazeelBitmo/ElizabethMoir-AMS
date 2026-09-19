import { eq } from "drizzle-orm";
import type { LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  auditLog,
  devices,
  groups,
  people,
  rawEvents,
  scans,
  tutors,
  unknownEnrollments,
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

const HEADER = "enroll_no,full_name,branch,group,tutor_initials,admission_no";
const FILE = `${HEADER}
11007,Ann Perera,student,Form 1,AP,2024/001
11008,Ben Silva,student,Form 1,AP,2024/002
2001,Cal Fernando,staff,Junior Staff,,`;

let h: TestHarness;
let admin: LoggedIn;

beforeAll(async () => {
  h = await createHarness();
}, 60_000);

beforeEach(async () => {
  await h.db.truncateAll();
  await seedUser(h, { email: HEAD, role: "full" });
  await seedUser(h, { email: OFFICE, role: "student_only" });
  await h.db.db.insert(groups).values([
    { name: "Form 1", branch: "student", displayOrder: 1 },
    { name: "Junior Staff", branch: "staff", displayOrder: 1 },
  ]);
  admin = await login(h, HEAD);
});

afterAll(async () => {
  await h.close();
});

function get(
  url: string,
  who: LoggedIn = admin,
): Promise<LightMyRequestResponse> {
  return h.app.server.inject({
    method: "GET",
    url,
    headers: { cookie: who.cookie },
  });
}

function post(
  url: string,
  payload: unknown,
  who: LoggedIn = admin,
  extra: Record<string, string> = {},
): Promise<LightMyRequestResponse> {
  return h.app.server.inject({
    method: "POST",
    url,
    payload: payload as never,
    headers: { cookie: who.cookie, "x-csrf-token": who.csrfToken, ...extra },
  });
}

/** Uploads CSV text as a raw body, which readUpload accepts alongside multipart. */
function upload(
  url: string,
  csv: string,
  extra: Record<string, string> = {},
): Promise<LightMyRequestResponse> {
  return h.app.server.inject({
    method: "POST",
    url,
    payload: csv,
    headers: {
      cookie: admin.cookie,
      "x-csrf-token": admin.csrfToken,
      "content-type": "text/csv",
      ...extra,
    },
  });
}

describe("admin is closed to student_only accounts", () => {
  const urls = [
    "/api/admin/people",
    "/api/admin/groups",
    "/api/admin/devices",
    "/api/admin/unknown-enrollments",
    "/api/admin/tutors",
  ];

  it("refuses every admin read", async () => {
    const office = await login(h, OFFICE);
    for (const url of urls) {
      const res = await get(url, office);
      expect(res.statusCode, url).toBe(403);
    }
  });

  it("refuses admin writes", async () => {
    const office = await login(h, OFFICE);
    const res = await post(
      "/api/admin/people",
      { enrollNo: "9", fullName: "Sneaky" },
      office,
    );
    expect(res.statusCode).toBe(403);
    expect(await h.db.db.select().from(people)).toHaveLength(0);
  });

  it("refuses an anonymous request", async () => {
    const res = await h.app.server.inject({
      method: "GET",
      url: "/api/admin/people",
    });
    expect(res.statusCode).toBe(401);
  });
});

describe("CSV import", () => {
  it("previews without writing anything", async () => {
    const res = await upload("/api/admin/people/import", FILE);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.preview.counts).toMatchObject({
      create: 3,
      update: 0,
      deactivate: 0,
    });
    expect(body.planHash).toEqual(expect.any(String));
    // Nothing committed by a preview.
    expect(await h.db.db.select().from(people)).toHaveLength(0);
  });

  it("imports the directory once confirmed", async () => {
    const preview = (await upload("/api/admin/people/import", FILE)).json();
    const res = await upload("/api/admin/people/import/confirm", FILE, {
      "x-plan-hash": preview.planHash,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().result).toMatchObject({
      created: 3,
      updated: 0,
      deactivated: 0,
    });

    const rows = await h.db.db.select().from(people);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.enrollNo).sort()).toEqual([
      "11007",
      "11008",
      "2001",
    ]);
  });

  it("creates the tutors named in the file", async () => {
    const preview = (await upload("/api/admin/people/import", FILE)).json();
    await upload("/api/admin/people/import/confirm", FILE, {
      "x-plan-hash": preview.planHash,
    });
    const rows = await h.db.db.select().from(tutors);
    expect(rows.map((t) => t.initials)).toEqual(["AP"]);
  });

  it("writes nothing at all when any row is invalid", async () => {
    const broken = `${FILE}\n11009,,student,Form 1,,`;
    const res = await upload("/api/admin/people/import", broken);
    expect(res.statusCode).toBe(422);
    expect(res.json().problems[0]).toMatchObject({
      lineNumber: 5,
      column: "full_name",
    });
    expect(await h.db.db.select().from(people)).toHaveLength(0);
  });

  it("names the row and the problem rather than failing generically", async () => {
    const res = await upload(
      "/api/admin/people/import",
      `${HEADER}\n11007,Ann,student,Form 9,,`,
    );
    const problem = res.json().problems[0];
    expect(problem.lineNumber).toBe(2);
    expect(problem.message).toMatch(/does not exist/);
  });

  it("updates rather than duplicating on a re-import", async () => {
    const first = (await upload("/api/admin/people/import", FILE)).json();
    await upload("/api/admin/people/import/confirm", FILE, {
      "x-plan-hash": first.planHash,
    });

    const changed = FILE.replace("Ann Perera", "Ann R Perera");
    const second = (await upload("/api/admin/people/import", changed)).json();
    expect(second.preview.counts).toMatchObject({
      create: 0,
      update: 1,
      unchanged: 2,
    });

    const res = await upload("/api/admin/people/import/confirm", changed, {
      "x-plan-hash": second.planHash,
    });
    expect(res.statusCode).toBe(200);
    expect(await h.db.db.select().from(people)).toHaveLength(3);
    const [ann] = await h.db.db
      .select()
      .from(people)
      .where(eq(people.enrollNo, "11007"));
    expect(ann?.fullName).toBe("Ann R Perera");
  });

  describe("deactivation", () => {
    async function importFull() {
      const p = (await upload("/api/admin/people/import", FILE)).json();
      await upload("/api/admin/people/import/confirm", FILE, {
        "x-plan-hash": p.planHash,
      });
    }

    it("requires an explicit extra confirmation", async () => {
      await importFull();
      const shorter = `${HEADER}\n11007,Ann Perera,student,Form 1,AP,2024/001`;
      const preview = (
        await upload("/api/admin/people/import", shorter)
      ).json();
      expect(preview.preview.counts.deactivate).toBe(2);

      const res = await upload("/api/admin/people/import/confirm", shorter, {
        "x-plan-hash": preview.planHash,
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toBe("needs_deactivation_confirmation");
      // Still active: nothing was removed without the extra confirmation.
      const active = await h.db.db
        .select()
        .from(people)
        .where(eq(people.isActive, true));
      expect(active).toHaveLength(3);
    });

    it("proceeds when the confirmation is given", async () => {
      await importFull();
      const shorter = `${HEADER}\n11007,Ann Perera,student,Form 1,AP,2024/001`;
      const preview = (
        await upload("/api/admin/people/import", shorter)
      ).json();
      const res = await upload("/api/admin/people/import/confirm", shorter, {
        "x-plan-hash": preview.planHash,
        "x-confirm-deactivations": "true",
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().result.deactivated).toBe(2);
      const active = await h.db.db
        .select()
        .from(people)
        .where(eq(people.isActive, true));
      expect(active).toHaveLength(1);
    });

    it("lists everyone who would be deactivated, not a sample", async () => {
      await importFull();
      const shorter = `${HEADER}\n11007,Ann Perera,student,Form 1,AP,2024/001`;
      const preview = (
        await upload("/api/admin/people/import", shorter)
      ).json();
      expect(preview.preview.deactivates).toHaveLength(2);
    });

    it("brings someone back when they reappear in a later file", async () => {
      await importFull();
      const shorter = `${HEADER}\n11007,Ann Perera,student,Form 1,AP,2024/001`;
      const p1 = (await upload("/api/admin/people/import", shorter)).json();
      await upload("/api/admin/people/import/confirm", shorter, {
        "x-plan-hash": p1.planHash,
        "x-confirm-deactivations": "true",
      });

      const p2 = (await upload("/api/admin/people/import", FILE)).json();
      await upload("/api/admin/people/import/confirm", FILE, {
        "x-plan-hash": p2.planHash,
      });
      const active = await h.db.db
        .select()
        .from(people)
        .where(eq(people.isActive, true));
      expect(active).toHaveLength(3);
    });
  });

  it("refuses a confirm whose plan no longer matches", async () => {
    const preview = (await upload("/api/admin/people/import", FILE)).json();
    // Someone else adds one of these people in the meantime.
    const [group] = await h.db.db
      .select()
      .from(groups)
      .where(eq(groups.branch, "student"));
    await h.db.db
      .insert(people)
      .values({
        enrollNo: "11007",
        fullName: "Ann Perera",
        groupId: group!.id,
      });

    const res = await upload("/api/admin/people/import/confirm", FILE, {
      "x-plan-hash": preview.planHash,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("plan_changed");
    expect(res.json().preview.counts.create).toBe(2);
  });

  it("refuses a confirm for a different file", async () => {
    const preview = (await upload("/api/admin/people/import", FILE)).json();
    const other = `${HEADER}\n11099,Someone Else,student,Form 1,,`;
    const res = await upload("/api/admin/people/import/confirm", other, {
      "x-plan-hash": preview.planHash,
    });
    expect(res.statusCode).toBe(409);
    expect(await h.db.db.select().from(people)).toHaveLength(0);
  });

  it("records the import and each person in the audit log", async () => {
    const preview = (await upload("/api/admin/people/import", FILE)).json();
    await upload("/api/admin/people/import/confirm", FILE, {
      "x-plan-hash": preview.planHash,
    });
    const entries = await h.db.db.select().from(auditLog);
    const actions = entries.map((e) => e.action);
    expect(actions).toContain("csv_import");
    expect(actions.filter((a) => a === "person_created")).toHaveLength(3);
  });
});

describe("people endpoints", () => {
  beforeEach(async () => {
    const preview = (await upload("/api/admin/people/import", FILE)).json();
    await upload("/api/admin/people/import/confirm", FILE, {
      "x-plan-hash": preview.planHash,
    });
  });

  it("lists people with their group and tutor", async () => {
    const body = (await get("/api/admin/people")).json();
    expect(body.total).toBe(3);
    const ann = body.people.find(
      (p: { enrollNo: string }) => p.enrollNo === "11007",
    );
    expect(ann).toMatchObject({
      groupName: "Form 1",
      branch: "student",
      tutorInitials: "AP",
    });
  });

  it("filters by branch", async () => {
    const body = (await get("/api/admin/people?branch=staff")).json();
    expect(body.people).toHaveLength(1);
    expect(body.people[0].enrollNo).toBe("2001");
  });

  it("searches by name and by enrolment number", async () => {
    expect(
      (await get("/api/admin/people?q=Perera")).json().people,
    ).toHaveLength(1);
    expect((await get("/api/admin/people?q=2001")).json().people).toHaveLength(
      1,
    );
  });

  it("paginates, with a bounded page size", async () => {
    const body = (await get("/api/admin/people?limit=2&page=1")).json();
    expect(body.people).toHaveLength(2);
    expect(body.total).toBe(3);
    // Above the maximum is rejected rather than silently honoured.
    expect((await get("/api/admin/people?limit=500")).statusCode).toBe(400);
  });

  it("hides deactivated people unless asked, and can show only them", async () => {
    const [ann] = await h.db.db
      .select()
      .from(people)
      .where(eq(people.enrollNo, "11007"));
    await h.db.db
      .update(people)
      .set({ isActive: false })
      .where(eq(people.id, ann!.id));
    expect((await get("/api/admin/people")).json().total).toBe(2);
    expect((await get("/api/admin/people?active=all")).json().total).toBe(3);
    expect(
      (await get("/api/admin/people?includeInactive=true")).json().total,
    ).toBe(3);
    const only = (await get("/api/admin/people?active=false")).json();
    expect(only.total).toBe(1);
    expect(only.people[0].enrollNo).toBe("11007");
  });

  it("filters by tutor", async () => {
    const tutorsList = (await get("/api/admin/tutors")).json().tutors;
    const ap = tutorsList.find((t: { initials: string }) => t.initials === "AP");
    const body = (await get(`/api/admin/people?tutorId=${ap.id}`)).json();
    expect(body.total).toBe(2);
    expect(body.people.every((p: { tutorInitials: string }) => p.tutorInitials === "AP")).toBe(true);
  });

  describe("deleting a person", () => {
    it("refuses while they are active", async () => {
      const [ann] = await h.db.db
        .select()
        .from(people)
        .where(eq(people.enrollNo, "11007"));
      const res = await h.app.server.inject({
        method: "DELETE",
        url: `/api/admin/people/${ann!.id}`,
        headers: { cookie: admin.cookie, "x-csrf-token": admin.csrfToken },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toBe("still_active");
      expect((await get("/api/admin/people?active=all")).json().total).toBe(3);
    });

    it("removes a deactivated person with everything computed for them, and audits it", async () => {
      const [ann] = await h.db.db
        .select()
        .from(people)
        .where(eq(people.enrollNo, "11007"));
      // A day of history, so there is something to remove.
      await h.app.server.inject({
        method: "POST",
        url: `/ingest/${INGEST_TOKEN}/raw`,
        headers: { "content-type": "application/json" },
        payload: JSON.stringify([
          { EmpId: "11007", AttTime: "2026-09-16 07:30:00", CheckingStatus: "0", DeviceID: "GATE-1" },
        ]),
      });
      await h.app.whenIdle();
      await h.app.processor.processPending();
      expect(await h.db.db.select().from(scans)).toHaveLength(1);

      await h.app.server.inject({
        method: "PATCH",
        url: `/api/admin/people/${ann!.id}`,
        payload: { isActive: false },
        headers: { cookie: admin.cookie, "x-csrf-token": admin.csrfToken },
      });
      const res = await h.app.server.inject({
        method: "DELETE",
        url: `/api/admin/people/${ann!.id}`,
        headers: { cookie: admin.cookie, "x-csrf-token": admin.csrfToken },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().deleted).toEqual({ dayRecords: 1, scans: 1 });

      expect((await get("/api/admin/people?active=all")).json().total).toBe(2);
      expect(await h.db.db.select().from(scans)).toHaveLength(0);
      // The raw delivery is untouched: nothing the reader said is lost.
      expect(await h.db.db.select().from(rawEvents)).toHaveLength(1);

      const entries = await h.db.db.select().from(auditLog);
      const deleted = entries.find((e) => e.action === "person_deleted");
      expect(deleted?.entityId).toBe(ann!.id);
      expect((deleted?.before as { fullName: string }).fullName).toBe("Ann Perera");
    });

    it("404s for someone who is not there", async () => {
      const res = await h.app.server.inject({
        method: "DELETE",
        url: "/api/admin/people/00000000-0000-0000-0000-000000000000",
        headers: { cookie: admin.cookie, "x-csrf-token": admin.csrfToken },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  it("refuses a duplicate enrolment number", async () => {
    const res = await post("/api/admin/people", {
      enrollNo: "11007",
      fullName: "Impostor",
    });
    expect(res.statusCode).toBe(409);
  });
});

describe("unknown enrolment numbers", () => {
  async function scanFromUnknown(enrollNo: string, attTime: string) {
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

  it("lists a number nobody has claimed, with when it was seen", async () => {
    await scanFromUnknown("99999", "2026-09-16 07:30:00");
    const body = (await get("/api/admin/unknown-enrollments")).json();
    expect(body.total).toBe(1);
    expect(body.unknownEnrollments[0]).toMatchObject({
      enrollNo: "99999",
      scanCount: 1,
    });
  });

  it("adding the person by hand claims the scans too, the same as attaching", async () => {
    await scanFromUnknown("99999", "2026-09-16 07:30:00");
    const [group] = await h.db.db
      .select()
      .from(groups)
      .where(eq(groups.branch, "student"));

    const res = await post("/api/admin/people", {
      enrollNo: "99999",
      fullName: "Added By Hand",
      groupId: group!.id,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().daysRecomputed).toBe(1);

    const [scan] = await h.db.db
      .select()
      .from(scans)
      .where(eq(scans.enrollNo, "99999"));
    expect(scan?.personId).toBe(res.json().person.id);

    // No longer unknown, and their morning is on the register.
    expect((await get("/api/admin/unknown-enrollments")).json().total).toBe(0);
    const live = (
      await get("/api/register/live?date=2026-09-16")
    ).json();
    const row = live.rows.find(
      (r: { enrollNo: string }) => r.enrollNo === "99999",
    );
    expect(row?.firstIn).toBeTruthy();
  });

  it("attaches the number to a new person and claims the scans already stored", async () => {
    await scanFromUnknown("99999", "2026-09-16 07:30:00");
    const [group] = await h.db.db
      .select()
      .from(groups)
      .where(eq(groups.branch, "student"));

    const res = await post("/api/admin/unknown-enrollments/99999/attach", {
      create: { fullName: "New Student", groupId: group!.id },
    });
    expect(res.statusCode).toBe(200);

    const [person] = await h.db.db
      .select()
      .from(people)
      .where(eq(people.enrollNo, "99999"));
    expect(person?.fullName).toBe("New Student");

    // The scan recorded before anyone knew who they were now belongs to them.
    const [scan] = await h.db.db
      .select()
      .from(scans)
      .where(eq(scans.enrollNo, "99999"));
    expect(scan?.personId).toBe(person!.id);
  });

  it("drops off the list once resolved", async () => {
    await scanFromUnknown("99999", "2026-09-16 07:30:00");
    const [group] = await h.db.db
      .select()
      .from(groups)
      .where(eq(groups.branch, "student"));
    await post("/api/admin/unknown-enrollments/99999/attach", {
      create: { fullName: "New Student", groupId: group!.id },
    });
    expect((await get("/api/admin/unknown-enrollments")).json().total).toBe(0);
    const [row] = await h.db.db.select().from(unknownEnrollments);
    expect(row?.resolvedPersonId).not.toBeNull();
  });

  it("refuses to point an existing person with a different number at it", async () => {
    await scanFromUnknown("99999", "2026-09-16 07:30:00");
    const preview = (await upload("/api/admin/people/import", FILE)).json();
    await upload("/api/admin/people/import/confirm", FILE, {
      "x-plan-hash": preview.planHash,
    });
    const [ann] = await h.db.db
      .select()
      .from(people)
      .where(eq(people.enrollNo, "11007"));

    const res = await post("/api/admin/unknown-enrollments/99999/attach", {
      personId: ann!.id,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().message).toMatch(/already has enrolment number 11007/);
  });

  it("404s for a number that was never seen", async () => {
    const res = await post("/api/admin/unknown-enrollments/00000/attach", {
      create: { fullName: "Nobody" },
    });
    expect(res.statusCode).toBe(404);
  });

  describe("a deactivated person's card", () => {
    async function addAndDeactivate(enrollNo: string, fullName: string) {
      const [group] = await h.db.db
        .select()
        .from(groups)
        .where(eq(groups.branch, "student"));
      const created = (
        await post("/api/admin/people", {
          enrollNo,
          fullName,
          groupId: group!.id,
        })
      ).json().person as { id: string };
      const res = await h.app.server.inject({
        method: "PATCH",
        url: `/api/admin/people/${created.id}`,
        payload: { isActive: false },
        headers: { cookie: admin.cookie, "x-csrf-token": admin.csrfToken },
      });
      expect(res.statusCode).toBe(200);
      return created.id;
    }

    it("goes back on the unknown list, naming whose it was", async () => {
      const id = await addAndDeactivate("22222", "Left Last Term");
      await scanFromUnknown("22222", "2026-09-16 07:30:00");

      // Not filed under someone the register does not show.
      const [scan] = await h.db.db
        .select()
        .from(scans)
        .where(eq(scans.enrollNo, "22222"));
      expect(scan?.personId).toBeNull();

      const body = (await get("/api/admin/unknown-enrollments")).json();
      expect(body.total).toBe(1);
      expect(body.unknownEnrollments[0]).toMatchObject({
        enrollNo: "22222",
        formerPersonId: id,
        formerName: "Left Last Term",
      });
    });

    it("is claimed again when they are reactivated", async () => {
      const id = await addAndDeactivate("22222", "Back Again");
      await scanFromUnknown("22222", "2026-09-16 07:30:00");

      const res = await h.app.server.inject({
        method: "PATCH",
        url: `/api/admin/people/${id}`,
        payload: { isActive: true },
        headers: { cookie: admin.cookie, "x-csrf-token": admin.csrfToken },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().daysRecomputed).toBe(1);

      const [scan] = await h.db.db
        .select()
        .from(scans)
        .where(eq(scans.enrollNo, "22222"));
      expect(scan?.personId).toBe(id);
      expect((await get("/api/admin/unknown-enrollments")).json().total).toBe(0);
      const live = (await get("/api/register/live?date=2026-09-16")).json();
      const row = live.rows.find(
        (r: { enrollNo: string }) => r.enrollNo === "22222",
      );
      expect(row?.firstIn).toBeTruthy();
    });

    it("is claimed by attaching the number to them, which reactivates them", async () => {
      const id = await addAndDeactivate("22222", "Back Again");
      await scanFromUnknown("22222", "2026-09-16 07:30:00");

      const res = await post("/api/admin/unknown-enrollments/22222/attach", {
        personId: id,
      });
      expect(res.statusCode).toBe(200);
      const [person] = await h.db.db
        .select()
        .from(people)
        .where(eq(people.id, id));
      expect(person?.isActive).toBe(true);
      expect((await get("/api/admin/unknown-enrollments")).json().total).toBe(0);
    });

    it("cannot be given to a new person while they still hold the number", async () => {
      const id = await addAndDeactivate("22222", "Still Holds It");
      await scanFromUnknown("22222", "2026-09-16 07:30:00");
      const [group] = await h.db.db
        .select()
        .from(groups)
        .where(eq(groups.branch, "student"));

      const res = await post("/api/admin/unknown-enrollments/22222/attach", {
        create: { fullName: "A Twin", groupId: group!.id },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({
        error: "number_held_by_deactivated",
        personId: id,
      });
      expect(res.json().message).toMatch(/Still Holds It/);
    });
  });
});

describe("devices", () => {
  beforeEach(async () => {
    await h.db.db.insert(devices).values({ serial: "GATE-1" });
  });

  it("lists readers", async () => {
    const body = (await get("/api/admin/devices")).json();
    expect(body.devices[0]).toMatchObject({
      serial: "GATE-1",
      direction: "both",
    });
  });

  it("sets a reader's direction and audits the change", async () => {
    const [device] = await h.db.db.select().from(devices);
    const res = await h.app.server.inject({
      method: "PATCH",
      url: `/api/admin/devices/${device!.id}`,
      payload: { direction: "entry", label: "Front gate" },
      headers: { cookie: admin.cookie, "x-csrf-token": admin.csrfToken },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().device).toMatchObject({
      direction: "entry",
      label: "Front gate",
    });

    const entries = await h.db.db.select().from(auditLog);
    expect(entries.map((e) => e.action)).toContain("device_configured");
  });

  it("rejects a direction that is not a direction", async () => {
    const [device] = await h.db.db.select().from(devices);
    const res = await h.app.server.inject({
      method: "PATCH",
      url: `/api/admin/devices/${device!.id}`,
      payload: { direction: "sideways" },
      headers: { cookie: admin.cookie, "x-csrf-token": admin.csrfToken },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("groups", () => {
  it("lists them in branch and display order", async () => {
    const body = (await get("/api/admin/groups")).json();
    expect(body.groups.map((g: { name: string }) => g.name)).toEqual([
      "Junior Staff",
      "Form 1",
    ]);
  });

  it("creates a group", async () => {
    const res = await post("/api/admin/groups", {
      name: "Upper 6",
      branch: "student",
      displayOrder: 7,
    });
    expect(res.statusCode).toBe(201);
    expect(await h.db.db.select().from(groups)).toHaveLength(3);
  });

  async function importTheFile() {
    const preview = (await upload("/api/admin/people/import", FILE)).json();
    await upload("/api/admin/people/import/confirm", FILE, {
      "x-plan-hash": preview.planHash,
    });
  }

  it("says how many people each group holds", async () => {
    await importTheFile();
    const body = (await get("/api/admin/groups")).json();
    const form1 = body.groups.find((g: { name: string }) => g.name === "Form 1");
    const staff = body.groups.find(
      (g: { name: string }) => g.name === "Junior Staff",
    );
    expect(form1.peopleCount).toBe(2);
    expect(staff.peopleCount).toBe(1);
  });

  it("refuses a second group with the same name, whatever the case", async () => {
    const res = await post("/api/admin/groups", {
      name: "form 1",
      branch: "student",
      displayOrder: 9,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().message).toMatch(/already a group called/);
    expect(await h.db.db.select().from(groups)).toHaveLength(2);
  });

  it("records who created a group", async () => {
    await post("/api/admin/groups", {
      name: "Upper 6",
      branch: "student",
      displayOrder: 7,
    });
    const entries = await h.db.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, "group_created"));
    expect(entries).toHaveLength(1);
    expect((entries[0]!.after as { name: string }).name).toBe("Upper 6");
  });

  it("refuses to move a group with people in it to the other branch", async () => {
    // A staff group becoming a student group would put its members in
    // front of every student-only account. That is not an edit.
    await importTheFile();
    const [staff] = await h.db.db
      .select()
      .from(groups)
      .where(eq(groups.name, "Junior Staff"));
    const res = await h.app.server.inject({
      method: "PATCH",
      url: `/api/admin/groups/${staff!.id}`,
      payload: { branch: "student" },
      headers: { cookie: admin.cookie, "x-csrf-token": admin.csrfToken },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe("group_has_people");

    // An empty group may be moved, because nobody's visibility changes.
    const created = (
      await post("/api/admin/groups", {
        name: "Empty",
        branch: "student",
        displayOrder: 20,
      })
    ).json().group;
    const moved = await h.app.server.inject({
      method: "PATCH",
      url: `/api/admin/groups/${created.id}`,
      payload: { branch: "staff" },
      headers: { cookie: admin.cookie, "x-csrf-token": admin.csrfToken },
    });
    expect(moved.statusCode).toBe(200);
    expect(moved.json().group.branch).toBe("staff");
  });

  it("records a change with what it was before", async () => {
    const [group] = await h.db.db
      .select()
      .from(groups)
      .where(eq(groups.name, "Form 1"));
    await h.app.server.inject({
      method: "PATCH",
      url: `/api/admin/groups/${group!.id}`,
      payload: { expectsAttendance: false },
      headers: { cookie: admin.cookie, "x-csrf-token": admin.csrfToken },
    });
    const [entry] = await h.db.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, "group_modified"));
    expect(entry).toBeDefined();
    expect((entry!.before as { expectsAttendance: boolean }).expectsAttendance).toBe(true);
    expect((entry!.after as { expectsAttendance: boolean }).expectsAttendance).toBe(false);
  });

  it("renames a group without a deploy", async () => {
    const [group] = await h.db.db
      .select()
      .from(groups)
      .where(eq(groups.name, "Form 1"));
    const res = await h.app.server.inject({
      method: "PATCH",
      url: `/api/admin/groups/${group!.id}`,
      payload: { name: "Year 7" },
      headers: { cookie: admin.cookie, "x-csrf-token": admin.csrfToken },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().group.name).toBe("Year 7");
  });
});

describe("tutors", () => {
  beforeEach(async () => {
    const preview = (await upload("/api/admin/people/import", FILE)).json();
    await upload("/api/admin/people/import/confirm", FILE, {
      "x-plan-hash": preview.planHash,
    });
  });

  function send(method: "PATCH" | "DELETE", url: string, payload?: unknown) {
    return h.app.server.inject({
      method,
      url,
      payload: payload as never,
      headers: { cookie: admin.cookie, "x-csrf-token": admin.csrfToken },
    });
  }

  it("lists them with how many people each has", async () => {
    const body = (await get("/api/admin/tutors")).json();
    expect(body.tutors).toEqual([
      expect.objectContaining({ initials: "AP", peopleCount: 2 }),
    ]);
  });

  it("adds one by hand, upper-cased, and audits it", async () => {
    const res = await post("/api/admin/tutors", {
      initials: "rj",
      fullName: "R. Jayasinghe",
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().tutor).toMatchObject({
      initials: "RJ",
      fullName: "R. Jayasinghe",
      peopleCount: 0,
    });
    const entries = await h.db.db.select().from(auditLog);
    expect(entries.some((e) => e.action === "tutor_created")).toBe(true);
  });

  it("refuses initials already in use, whatever the case", async () => {
    const res = await post("/api/admin/tutors", { initials: "ap" });
    expect(res.statusCode).toBe(409);
  });

  it("renames one", async () => {
    const ap = (await get("/api/admin/tutors")).json().tutors[0];
    const res = await send("PATCH", `/api/admin/tutors/${ap.id}`, {
      fullName: "Ann Perera-Smith",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().tutor.fullName).toBe("Ann Perera-Smith");
    expect(res.json().tutor.initials).toBe("AP");
  });

  it("will not remove a tutor who still has people", async () => {
    const ap = (await get("/api/admin/tutors")).json().tutors[0];
    const res = await send("DELETE", `/api/admin/tutors/${ap.id}`);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: "in_use", peopleCount: 2 });
    expect((await get("/api/admin/tutors")).json().tutors).toHaveLength(1);
  });

  it("removes a tutor nobody has, and audits it", async () => {
    const created = (await post("/api/admin/tutors", { initials: "ZZ" })).json().tutor;
    const res = await send("DELETE", `/api/admin/tutors/${created.id}`);
    expect(res.statusCode).toBe(204);
    expect((await get("/api/admin/tutors")).json().tutors).toHaveLength(1);
    const entries = await h.db.db.select().from(auditLog);
    expect(entries.some((e) => e.action === "tutor_deleted")).toBe(true);
  });

  it("is closed to a student-only account", async () => {
    const office = await login(h, OFFICE);
    expect((await get("/api/admin/tutors", office)).statusCode).toBe(403);
    expect(
      (await post("/api/admin/tutors", { initials: "QQ" }, office)).statusCode,
    ).toBe(403);
  });
});
