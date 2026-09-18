import { eq } from "drizzle-orm";
import type { LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { validateSetting } from "../src/admin/system.js";
import {
  auditLog,
  calendarDays,
  rawEvents,
  sessions,
  users,
} from "../src/db/schema/index.js";
import {
  createHarness,
  INGEST_TOKEN,
  login,
  seedUser,
  TEST_PASSWORD,
  type LoggedIn,
  type TestHarness,
} from "./helpers/app.js";

const HEAD = "head@school.example";
const DEPUTY = "deputy@school.example";
const OFFICE = "office@school.example";

let h: TestHarness;
let admin: LoggedIn;

beforeAll(async () => {
  h = await createHarness();
}, 60_000);

beforeEach(async () => {
  await h.db.truncateAll();
  await h.app.settings.invalidate();
  await seedUser(h, { email: HEAD, role: "full" });
  await seedUser(h, { email: DEPUTY, role: "full" });
  await seedUser(h, { email: OFFICE, role: "student_only" });
  admin = await login(h, HEAD);
});

afterAll(async () => {
  await h.close();
});

const get = (
  url: string,
  who: LoggedIn = admin,
): Promise<LightMyRequestResponse> =>
  h.app.server.inject({ method: "GET", url, headers: { cookie: who.cookie } });

const send = (
  method: "POST" | "PATCH" | "DELETE",
  url: string,
  payload: unknown,
  who: LoggedIn = admin,
): Promise<LightMyRequestResponse> =>
  h.app.server.inject({
    method,
    url,
    payload: payload as never,
    headers: { cookie: who.cookie, "x-csrf-token": who.csrfToken },
  });

describe("every system endpoint is closed to a student_only account", () => {
  it("refuses reads and writes", async () => {
    const office = await login(h, OFFICE);
    for (const url of [
      "/api/admin/users",
      "/api/admin/settings",
      "/api/admin/audit",
      "/api/admin/dead-letter",
      "/api/admin/calendar?from=2026-09-01&to=2026-09-30",
    ]) {
      expect((await get(url, office)).statusCode, url).toBe(403);
    }
    const res = await send(
      "POST",
      "/api/admin/users",
      {
        email: "x@school.example",
        fullName: "X",
        role: "full",
      },
      office,
    );
    expect(res.statusCode).toBe(403);
  });
});

describe("users", () => {
  it("lists accounts without exposing password hashes", async () => {
    const body = (await get("/api/admin/users")).json();
    expect(body.total).toBe(3);
    expect(JSON.stringify(body)).not.toMatch(
      /argon2|passwordHash|password_hash/i,
    );
  });

  it("creates an account and shows its password once", async () => {
    const res = await send("POST", "/api/admin/users", {
      email: "New.Person@school.example",
      fullName: "New Person",
      role: "student_only",
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.user.email).toBe("new.person@school.example");
    expect(body.temporaryPassword).toEqual(expect.any(String));
    expect(body.temporaryPassword.length).toBeGreaterThanOrEqual(12);

    // And it works, forcing a change.
    const signIn = await h.app.server.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        email: "new.person@school.example",
        password: body.temporaryPassword,
      },
    });
    expect(signIn.statusCode).toBe(200);
    expect(signIn.json().user.mustChangePassword).toBe(true);
  }, 30_000);

  it("refuses a duplicate address", async () => {
    const res = await send("POST", "/api/admin/users", {
      email: HEAD,
      fullName: "Impostor",
      role: "full",
    });
    expect(res.statusCode).toBe(409);
  });

  it("resets a password, ends that account's sessions, and shows the new one once", async () => {
    const [office] = await h.db.db
      .select()
      .from(users)
      .where(eq(users.email, OFFICE));
    const officeSession = await login(h, OFFICE);
    expect((await get("/api/auth/me", officeSession)).statusCode).toBe(200);

    const res = await send("PATCH", `/api/admin/users/${office!.id}`, {
      resetPassword: true,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().temporaryPassword).toEqual(expect.any(String));

    // The old session no longer works, and neither does the old password.
    expect((await get("/api/auth/me", officeSession)).statusCode).toBe(401);
    const oldPassword = await h.app.server.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: OFFICE, password: TEST_PASSWORD },
    });
    expect(oldPassword.statusCode).toBe(401);
  }, 30_000);

  it("ends an account's sessions when it is deactivated", async () => {
    const [office] = await h.db.db
      .select()
      .from(users)
      .where(eq(users.email, OFFICE));
    const officeSession = await login(h, OFFICE);
    await send("PATCH", `/api/admin/users/${office!.id}`, { isActive: false });
    expect((await get("/api/auth/me", officeSession)).statusCode).toBe(401);
    const revoked = await h.db.db
      .select()
      .from(sessions)
      .where(eq(sessions.userId, office!.id));
    expect(revoked.every((s) => s.revokedAt !== null)).toBe(true);
  });

  describe("guards against locking the school out", () => {
    it("refuses to let you deactivate yourself", async () => {
      const [head] = await h.db.db
        .select()
        .from(users)
        .where(eq(users.email, HEAD));
      const res = await send("PATCH", `/api/admin/users/${head!.id}`, {
        isActive: false,
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toBe("cannot_deactivate_self");
    });

    it("refuses to let you change your own role", async () => {
      const [head] = await h.db.db
        .select()
        .from(users)
        .where(eq(users.email, HEAD));
      const res = await send("PATCH", `/api/admin/users/${head!.id}`, {
        role: "student_only",
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toBe("cannot_change_own_role");
    });

    it("always leaves at least one administrator, whoever is removed", async () => {
      // The invariant the two guards above actually produce: an
      // administrator can remove every other administrator, but never
      // themselves, so a way back in always survives.
      const [deputy] = await h.db.db
        .select()
        .from(users)
        .where(eq(users.email, DEPUTY));
      expect(
        (await send("PATCH", `/api/admin/users/${deputy!.id}`, { isActive: false })).statusCode,
      ).toBe(200);

      const remaining = await h.db.db
        .select()
        .from(users)
        .where(eq(users.role, "full"));
      expect(remaining.filter((u) => u.isActive)).toHaveLength(1);
      expect(remaining.find((u) => u.isActive)?.email).toBe(HEAD);
    });

    it("allows removing an administrator while another remains", async () => {
      const [deputy] = await h.db.db
        .select()
        .from(users)
        .where(eq(users.email, DEPUTY));
      const res = await send("PATCH", `/api/admin/users/${deputy!.id}`, {
        isActive: false,
      });
      expect(res.statusCode).toBe(200);
    });
  });

  it("records every change in the audit log", async () => {
    const [office] = await h.db.db
      .select()
      .from(users)
      .where(eq(users.email, OFFICE));
    await send("POST", "/api/admin/users", {
      email: "another@school.example",
      fullName: "Another",
      role: "full",
    });
    await send("PATCH", `/api/admin/users/${office!.id}`, {
      fullName: "Renamed",
    });
    await send("PATCH", `/api/admin/users/${office!.id}`, { isActive: false });

    const entries = await h.db.db.select().from(auditLog);
    const actions = entries.map((e) => e.action);
    expect(actions).toContain("user_created");
    expect(actions).toContain("user_modified");
    expect(actions).toContain("user_deactivated");
    // A generated password must never be written down anywhere.
    expect(JSON.stringify(entries)).not.toMatch(/temporaryPassword/);
  }, 30_000);
});

describe("attendance rules", () => {
  it("returns the current values and the defaults beside them", async () => {
    const body = (await get("/api/admin/settings")).json();
    expect(body.settings.timezone).toBe("Asia/Colombo");
    expect(body.settings.late_threshold_default).toBe("08:00");
    expect(body.defaults.duplicate_window_seconds).toBe(60);
  });

  it("changes a rule and audits it", async () => {
    const res = await send("PATCH", "/api/admin/settings", {
      late_threshold_default: "08:30",
    });
    expect(res.statusCode).toBe(200);
    expect(
      (await get("/api/admin/settings")).json().settings.late_threshold_default,
    ).toBe("08:30");
    const entries = await h.db.db.select().from(auditLog);
    expect(entries.map((e) => e.action)).toContain("attendance_rule_changed");
  });

  it("changes nothing at all when any value is invalid", async () => {
    const res = await send("PATCH", "/api/admin/settings", {
      late_threshold_default: "08:30",
      timezone: "Mars/Olympus",
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().problems.join(" ")).toMatch(/timezone/);
    // The valid half was not applied either.
    expect(
      (await get("/api/admin/settings")).json().settings.late_threshold_default,
    ).toBe("08:00");
  });

  it("refuses a key that is not a setting", async () => {
    const res = await send("PATCH", "/api/admin/settings", {
      favourite_colour: "indigo",
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().problems.join(" ")).toMatch(/not a setting/);
  });

  it("takes a status map once the discovery run says what the values mean", async () => {
    const res = await send("PATCH", "/api/admin/settings", {
      checking_status_map: { "0": "in", "1": "out" },
    });
    expect(res.statusCode).toBe(200);
    expect(
      (await get("/api/admin/settings")).json().settings.checking_status_map,
    ).toEqual({
      "0": "in",
      "1": "out",
    });
  });
});

describe("school name", () => {
  it("starts generic and is set by the school, not by the code", async () => {
    const body = (await get("/api/admin/settings")).json();
    expect(body.settings.school_name).toBe("School");
    expect(body.defaults.school_name).toBe("School");
  });

  it("is trimmed, stored and audited like any other rule", async () => {
    const res = await send("PATCH", "/api/admin/settings", {
      school_name: "  Example High School  ",
    });
    expect(res.statusCode).toBe(200);
    expect((await get("/api/admin/settings")).json().settings.school_name).toBe(
      "Example High School",
    );
    const entries = await h.db.db.select().from(auditLog);
    expect(entries.map((e) => e.action)).toContain("attendance_rule_changed");
  });

  it("refuses an empty name or one nobody could print", async () => {
    expect(
      (await send("PATCH", "/api/admin/settings", { school_name: "   " }))
        .statusCode,
    ).toBe(422);
    expect(
      (
        await send("PATCH", "/api/admin/settings", {
          school_name: "x".repeat(101),
        })
      ).statusCode,
    ).toBe(422);
  });

  it("is readable by every signed-in account through /api/school, with the timezone", async () => {
    await send("PATCH", "/api/admin/settings", {
      school_name: "Example High School",
    });
    const office = await login(h, OFFICE);
    const res = await get("/api/school", office);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      name: "Example High School",
      timezone: "Asia/Colombo",
      logoVersion: null,
    });
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("is not readable without a session", async () => {
    const res = await h.app.server.inject({ method: "GET", url: "/api/school" });
    expect(res.statusCode).toBe(401);
  });
});

describe("the school's mark", () => {
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
    "base64",
  );
  const putLogo = (body: Buffer, type: string) =>
    h.app.server.inject({
      method: "PUT",
      url: "/api/admin/school/logo",
      payload: body,
      headers: {
        cookie: admin.cookie,
        "x-csrf-token": admin.csrfToken,
        "content-type": type,
      },
    });

  it("is absent until uploaded, then served to anyone, with a version", async () => {
    expect((await get("/api/school")).json().logoVersion).toBeNull();
    const nobody = await h.app.server.inject({ method: "GET", url: "/api/school/logo" });
    expect(nobody.statusCode).toBe(404);

    const put = await putLogo(png, "image/png");
    expect(put.statusCode).toBe(200);
    const version = put.json().version;
    expect(version).toMatch(/^[0-9a-f]{12}$/);
    expect((await get("/api/school")).json().logoVersion).toBe(version);

    // Public: the sign-in page shows it before there is a session.
    const served = await h.app.server.inject({ method: "GET", url: "/api/school/logo" });
    expect(served.statusCode).toBe(200);
    expect(served.headers["content-type"]).toBe("image/png");
    expect(served.rawPayload.equals(png)).toBe(true);
    expect(served.headers["etag"]).toBe(`"${version}"`);

    const cached = await h.app.server.inject({
      method: "GET",
      url: "/api/school/logo",
      headers: { "if-none-match": `"${version}"` },
    });
    expect(cached.statusCode).toBe(304);
  });

  it("refuses anything that is not an image, and is audited", async () => {
    expect((await putLogo(Buffer.from("<html>"), "text/html")).statusCode).toBe(415);
    await putLogo(png, "image/png");
    const removed = await send("DELETE", "/api/admin/school/logo", undefined);
    expect(removed.statusCode).toBe(200);
    expect((await get("/api/school")).json().logoVersion).toBeNull();
    const actions = (await h.db.db.select().from(auditLog)).map((e) => e.action);
    expect(actions.filter((a) => a === "school_mark_changed")).toHaveLength(2);
  });
});

describe("validateSetting", () => {
  it("accepts good values", () => {
    expect(validateSetting("timezone", "Europe/London").ok).toBe(true);
    expect(validateSetting("late_threshold_default", "08:15").ok).toBe(true);
    expect(validateSetting("duplicate_window_seconds", 90).ok).toBe(true);
    expect(validateSetting("checking_status_map", { "0": "in" }).ok).toBe(true);
  });

  it("rejects values that would quietly corrupt every figure", () => {
    expect(validateSetting("timezone", "+05:30").ok).toBe(false);
    expect(validateSetting("late_threshold_default", "25:00").ok).toBe(false);
    expect(validateSetting("duplicate_window_seconds", 0).ok).toBe(false);
    expect(validateSetting("duplicate_window_seconds", 99_999).ok).toBe(false);
    expect(validateSetting("checking_status_map", { "0": "sideways" }).ok).toBe(
      false,
    );
    expect(validateSetting("nonsense", "x").ok).toBe(false);
  });
});

describe("calendar", () => {
  it("sets a term of weekdays in one request", async () => {
    const res = await send("POST", "/api/admin/calendar", {
      from: "2026-09-14",
      to: "2026-09-20",
      type: "school_day",
      weekdaysOnly: true,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().days).toBe(5);

    const days = (
      await get("/api/admin/calendar?from=2026-09-14&to=2026-09-20")
    ).json().days;
    expect(days).toHaveLength(5);
    expect(days.every((d: { type: string }) => d.type === "school_day")).toBe(
      true,
    );
  });

  it("overwrites a date, so a holiday can be carved out of a term", async () => {
    await send("POST", "/api/admin/calendar", {
      from: "2026-09-14",
      to: "2026-09-18",
      type: "school_day",
    });
    await send("POST", "/api/admin/calendar", {
      from: "2026-09-16",
      to: "2026-09-16",
      type: "holiday",
      label: "Poya day",
    });
    const days = (
      await get("/api/admin/calendar?from=2026-09-14&to=2026-09-18")
    ).json().days;
    const holiday = days.find((d: { date: string }) => d.date === "2026-09-16");
    expect(holiday).toMatchObject({ type: "holiday", label: "Poya day" });
  });

  it("refuses a reversed or absurd range", async () => {
    expect(
      (
        await send("POST", "/api/admin/calendar", {
          from: "2026-09-20",
          to: "2026-09-14",
          type: "school_day",
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await send("POST", "/api/admin/calendar", {
          from: "2020-01-01",
          to: "2026-01-01",
          type: "school_day",
        })
      ).statusCode,
    ).toBe(400);
  });

  it("is audited", async () => {
    await send("POST", "/api/admin/calendar", {
      from: "2026-09-14",
      to: "2026-09-18",
      type: "school_day",
    });
    const entries = await h.db.db.select().from(auditLog);
    expect(entries.some((e) => e.entity === "calendar")).toBe(true);
  });
});

describe("audit log", () => {
  beforeEach(async () => {
    await send("PATCH", "/api/admin/settings", {
      late_threshold_default: "08:30",
    });
  });

  it("shows who did what, with the account's name", async () => {
    const body = (await get("/api/admin/audit")).json();
    const entry = body.entries.find(
      (e: { action: string }) => e.action === "attendance_rule_changed",
    );
    expect(entry.userEmail).toBe(HEAD);
    expect(entry.userName).toBe("head");
  });

  it("does not put IP addresses beside people's names", async () => {
    const body = (await get("/api/admin/audit")).json();
    expect(JSON.stringify(body)).not.toMatch(/"ip"/);
  });

  it("filters by action and by user", async () => {
    const byAction = (
      await get("/api/admin/audit?action=login_success")
    ).json();
    expect(
      byAction.entries.every(
        (e: { action: string }) => e.action === "login_success",
      ),
    ).toBe(true);

    const [head] = await h.db.db
      .select()
      .from(users)
      .where(eq(users.email, HEAD));
    const byUser = (await get(`/api/admin/audit?user=${head!.id}`)).json();
    expect(byUser.total).toBeGreaterThan(0);
  });

  it("paginates newest first", async () => {
    const body = (await get("/api/admin/audit?limit=1")).json();
    expect(body.entries).toHaveLength(1);
    expect(body.total).toBeGreaterThan(1);
  });

  it("exports as CSV, and says in the log that it did", async () => {
    const res = await get("/api/admin/audit?format=csv&action=attendance_rule_changed");
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
    expect(res.headers["content-disposition"]).toMatch(/audit-log-\d{4}-\d{2}-\d{2}\.csv/);
    expect(res.headers["cache-control"]).toBe("no-store");

    const body = res.body;
    expect(body.startsWith("\uFEFF")).toBe(true);
    expect(body).toContain("Action: attendance_rule_changed");
    expect(body).toContain('"attendance_rule_changed"');
    expect(body).toContain('"head"');
    expect(body).toContain(HEAD);
    // The filter applied to the file as it does to the screen.
    expect(body).not.toContain('"login_success"');
    // No address next to anybody's name.
    expect(body).not.toMatch(/127\.0\.0\.1/);

    const entries = await h.db.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, "audit_export"));
    expect(entries).toHaveLength(1);
    expect((entries[0]!.after as { rows: number }).rows).toBeGreaterThan(0);
  });

  it("defuses a formula in an exported value", async () => {
    await send("PATCH", "/api/admin/settings", {
      school_name: "=HYPERLINK(\"http://x\")",
    });
    const res = await get("/api/admin/audit?format=csv");
    // Inside the JSON column the value is still there, but the cell itself
    // never begins with the character a spreadsheet would execute.
    for (const line of res.body.split("\r\n")) {
      for (const cell of line.split('","')) {
        expect(cell.replace(/^"/, "")).not.toMatch(/^[=+\-@]/);
      }
    }
  });

  it("offers the list of actions so a filter can be built without guessing", async () => {
    const body = (await get("/api/admin/audit")).json();
    expect(body.actions).toContain("login_success");
    expect(body.actions).toContain("dead_letter_replay");
  });
});

describe("failed deliveries", () => {
  async function aFailedDelivery() {
    await h.app.server.inject({
      method: "POST",
      url: `/ingest/${INGEST_TOKEN}/raw`,
      headers: { "content-type": "application/json" },
      payload: JSON.stringify([
        { EmpId: "11007", AttTime: "not a timestamp", DeviceID: "GATE-1" },
      ]),
    });
    await h.app.whenIdle();
    await h.app.processor.processPending();
  }

  it("lists a delivery that could not be interpreted, with the reason", async () => {
    await aFailedDelivery();
    const body = (await get("/api/admin/dead-letter")).json();
    expect(body.total).toBe(1);
    expect(body.failures[0].processError).toMatch(/not YYYY-MM-DD/);
    expect(body.failures[0].bodyPreview).toContain("11007");
  });

  it("can be set aside and taken back, kept whole and audited", async () => {
    await aFailedDelivery();
    const listed = (await get("/api/admin/dead-letter")).json();
    expect(listed.total).toBe(1);
    const id = listed.failures[0].id;

    const dismissed = await send("PATCH", `/api/admin/dead-letter/${id}`, {
      dismissed: true,
    });
    expect(dismissed.statusCode).toBe(200);

    // Out of the working list, still in the full one, with who did it.
    expect((await get("/api/admin/dead-letter")).json().total).toBe(0);
    const full = (
      await get("/api/admin/dead-letter?includeDismissed=true")
    ).json();
    expect(full.total).toBe(1);
    expect(full.failures[0].dismissedAt).toBeTruthy();
    expect(full.failures[0].dismissedBy).toBe("head");
    expect(full.failures[0].bodyPreview).toContain("not a timestamp");

    // And back.
    await send("PATCH", `/api/admin/dead-letter/${id}`, { dismissed: false });
    expect((await get("/api/admin/dead-letter")).json().total).toBe(1);

    const actions = (await h.db.db.select().from(auditLog)).map((e) => e.action);
    expect(actions).toContain("dead_letter_dismissed");
    expect(actions).toContain("dead_letter_restored");
  });

  it("refuses to dismiss a delivery that did not fail", async () => {
    const res = await send("PATCH", "/api/admin/dead-letter/999999", {
      dismissed: true,
    });
    expect(res.statusCode).toBe(404);
  });

  it("does not list deliveries that processed cleanly", async () => {
    await h.app.server.inject({
      method: "POST",
      url: `/ingest/${INGEST_TOKEN}/raw`,
      headers: { "content-type": "application/json" },
      payload: JSON.stringify([
        {
          EmpId: "11007",
          AttTime: "2026-09-16 07:30:00",
          CheckingStatus: "0",
          DeviceID: "GATE-1",
        },
      ]),
    });
    await h.app.whenIdle();
    await h.app.processor.processPending();
    expect((await get("/api/admin/dead-letter")).json().total).toBe(0);
  });

  it("replays one, and reports that it still fails when the body is genuinely bad", async () => {
    await aFailedDelivery();
    const [failure] = await h.db.db.select().from(rawEvents);
    const res = await send(
      "POST",
      `/api/admin/dead-letter/${failure!.id}/replay`,
      {},
    );
    expect(res.statusCode).toBe(200);
    // Honest: a malformed timestamp does not become valid on a second run.
    expect(res.json().resolved).toBe(false);
    expect(res.json().processError).toMatch(/not YYYY-MM-DD/);
  });

  it("resolves a replay once the cause is fixed", async () => {
    // A scan for somebody the directory did not know, which is not an error
    // but does leave the delivery marked. Give it a valid body and replay.
    await aFailedDelivery();
    const [failure] = await h.db.db.select().from(rawEvents);
    await h.db.db
      .update(rawEvents)
      .set({
        bodyJson: [
          {
            EmpId: "11007",
            AttTime: "2026-09-16 07:30:00",
            CheckingStatus: "0",
            DeviceID: "GATE-1",
          },
        ],
      })
      .where(eq(rawEvents.id, failure!.id));

    const res = await send(
      "POST",
      `/api/admin/dead-letter/${failure!.id}/replay`,
      {},
    );
    expect(res.json().resolved).toBe(true);
    expect((await get("/api/admin/dead-letter")).json().total).toBe(0);
  });

  it("is idempotent: replaying twice does not double anything", async () => {
    await h.app.server.inject({
      method: "POST",
      url: `/ingest/${INGEST_TOKEN}/raw`,
      headers: { "content-type": "application/json" },
      payload: JSON.stringify([
        {
          EmpId: "11007",
          AttTime: "2026-09-16 07:30:00",
          CheckingStatus: "0",
          DeviceID: "GATE-1",
        },
      ]),
    });
    await h.app.whenIdle();
    await h.app.processor.processPending();

    const [delivery] = await h.db.db.select().from(rawEvents);
    await send("POST", `/api/admin/dead-letter/${delivery!.id}/replay`, {});
    await send("POST", `/api/admin/dead-letter/${delivery!.id}/replay`, {});

    const scanRows = await h.db.db.select().from(rawEvents);
    expect(scanRows).toHaveLength(1);
  });

  it("404s an unknown delivery", async () => {
    expect(
      (await send("POST", "/api/admin/dead-letter/999999/replay", {}))
        .statusCode,
    ).toBe(404);
  });

  it("audits the replay", async () => {
    await aFailedDelivery();
    const [failure] = await h.db.db.select().from(rawEvents);
    await send("POST", `/api/admin/dead-letter/${failure!.id}/replay`, {});
    const entries = await h.db.db.select().from(auditLog);
    expect(entries.map((e) => e.action)).toContain("dead_letter_replay");
  });
});

describe("the calendar drives absence", () => {
  it("makes a date count once an administrator marks it a school day", async () => {
    // Nothing in the calendar: nobody can be absent.
    await h.db.db.delete(calendarDays);
    expect(await h.app.processor.markAbsences("2026-09-16")).toBe(0);

    await send("POST", "/api/admin/calendar", {
      from: "2026-09-16",
      to: "2026-09-16",
      type: "school_day",
    });
    // Still nobody, because there are no people — but the day is now real.
    const days = (
      await get("/api/admin/calendar?from=2026-09-16&to=2026-09-16")
    ).json().days;
    expect(days[0].type).toBe("school_day");
  });
});
