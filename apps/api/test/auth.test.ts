import { eq } from "drizzle-orm";
import type { LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLog, sessions, users } from "../src/db/schema/index.js";
import { SESSION_ABSOLUTE_MS, SESSION_IDLE_MS } from "../src/auth/policy.js";
import {
  createHarness,
  login,
  seedUser,
  TEST_PASSWORD,
  type TestHarness,
} from "./helpers/app.js";

const T0 = new Date("2026-09-17T08:00:00.000Z");
const HEAD = "head@school.example";
const OFFICE = "office@school.example";

let h: TestHarness;

beforeAll(async () => {
  h = await createHarness({ now: T0 });
}, 60_000);

beforeEach(async () => {
  h.setNow(T0);
  await h.db.truncateAll();
  await seedUser(h, { email: HEAD, role: "full" });
  await seedUser(h, { email: OFFICE, role: "student_only" });
});

afterAll(async () => {
  await h.close();
});

const post = (
  url: string,
  payload?: unknown,
  headers?: Record<string, string>,
): Promise<LightMyRequestResponse> =>
  h.app.server.inject({
    method: "POST",
    url,
    ...(payload === undefined ? {} : { payload: payload as object }),
    ...(headers === undefined ? {} : { headers }),
  });

describe("POST /api/auth/login", () => {
  it("signs in a full user and returns their role", async () => {
    const res = await post("/api/auth/login", {
      email: HEAD,
      password: TEST_PASSWORD,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.user.role).toBe("full");
    expect(body.user.email).toBe(HEAD);
    expect(body.csrfToken).toEqual(expect.any(String));
    // The password hash must never travel.
    expect(JSON.stringify(body)).not.toMatch(/argon2|passwordHash/i);
  });

  it("signs in a student_only user", async () => {
    const res = await post("/api/auth/login", {
      email: OFFICE,
      password: TEST_PASSWORD,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.role).toBe("student_only");
  });

  it("sets an httpOnly session cookie and a readable CSRF cookie", async () => {
    const res = await post("/api/auth/login", {
      email: HEAD,
      password: TEST_PASSWORD,
    });
    const session = res.cookies.find((c) => c.name === "ams_session");
    const csrf = res.cookies.find((c) => c.name === "ams_csrf");
    expect(session?.httpOnly).toBe(true);
    expect(session?.sameSite).toMatch(/lax/i);
    expect(csrf?.httpOnly).toBeFalsy();
  });

  it("stores only a hash of the session token, never the token", async () => {
    const res = await post("/api/auth/login", {
      email: HEAD,
      password: TEST_PASSWORD,
    });
    const token = res.cookies.find((c) => c.name === "ams_session")!.value;
    const rows = await h.db.db.select().from(sessions);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tokenHash).not.toBe(token);
    expect(rows[0]!.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is case-insensitive about the email address", async () => {
    const res = await post("/api/auth/login", {
      email: "Head@School.EXAMPLE",
      password: TEST_PASSWORD,
    });
    expect(res.statusCode).toBe(200);
  });

  it("gives the same answer for a wrong password and an unknown address", async () => {
    const wrong = await post("/api/auth/login", {
      email: HEAD,
      password: "not the password at all",
    });
    const unknown = await post("/api/auth/login", {
      email: "nobody@school.example",
      password: "not the password at all",
    });
    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrong.json()).toEqual(unknown.json());
  });

  it("refuses a deactivated account without saying so", async () => {
    await h.db.db
      .update(users)
      .set({ isActive: false })
      .where(eq(users.email, HEAD));
    const res = await post("/api/auth/login", {
      email: HEAD,
      password: TEST_PASSWORD,
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().message).not.toMatch(/deactivat|disabled|inactive/i);
  });

  it("rejects a malformed request with the same message as a bad password", async () => {
    const res = await post("/api/auth/login", { email: "x", password: "" });
    expect(res.json().error).toBe("invalid_credentials");
  });

  it("records success and failure in the audit log", async () => {
    await post("/api/auth/login", { email: HEAD, password: TEST_PASSWORD });
    await post("/api/auth/login", {
      email: HEAD,
      password: "wrong password here",
    });
    const entries = await h.db.db.select().from(auditLog);
    const actions = entries.map((e) => e.action);
    expect(actions).toContain("login_success");
    expect(actions).toContain("login_failure");
  });

  it("does not record the attempted password anywhere in the audit log", async () => {
    await post("/api/auth/login", {
      email: HEAD,
      password: "hunter2-is-the-secret",
    });
    const entries = await h.db.db.select().from(auditLog);
    expect(JSON.stringify(entries)).not.toContain("hunter2-is-the-secret");
  });
});

describe("account lockout", () => {
  async function failLogin(email: string) {
    return post("/api/auth/login", {
      email,
      password: "definitely wrong password",
    });
  }

  it("locks the account on the fifth failure within the window", async () => {
    for (let i = 0; i < 4; i++) {
      expect((await failLogin(HEAD)).statusCode).toBe(401);
    }
    expect((await failLogin(HEAD)).statusCode).toBe(429);
  });

  it("refuses the correct password while locked", async () => {
    for (let i = 0; i < 5; i++) await failLogin(HEAD);
    const res = await post("/api/auth/login", {
      email: HEAD,
      password: TEST_PASSWORD,
    });
    expect(res.statusCode).toBe(429);
  });

  it("lets the user back in once the lock expires", async () => {
    for (let i = 0; i < 5; i++) await failLogin(HEAD);
    h.setNow(new Date(T0.getTime() + 16 * 60_000));
    const res = await post("/api/auth/login", {
      email: HEAD,
      password: TEST_PASSWORD,
    });
    expect(res.statusCode).toBe(200);
  });

  it("records the lockout in the audit log", async () => {
    for (let i = 0; i < 5; i++) await failLogin(HEAD);
    const entries = await h.db.db.select().from(auditLog);
    expect(entries.map((e) => e.action)).toContain("lockout");
  });

  it("clears the failure count after a successful login", async () => {
    for (let i = 0; i < 3; i++) await failLogin(HEAD);
    await post("/api/auth/login", { email: HEAD, password: TEST_PASSWORD });
    const [u] = await h.db.db.select().from(users).where(eq(users.email, HEAD));
    expect(u?.failedAttempts).toBe(0);
    expect(u?.lockedUntil).toBeNull();
  });

  it("locks one account without locking the other", async () => {
    for (let i = 0; i < 5; i++) await failLogin(HEAD);
    // Same IP, so the per-IP rule is what this exercises: it is deliberately
    // independent of the account, and both are now blocked from this address.
    const other = await post("/api/auth/login", {
      email: OFFICE,
      password: TEST_PASSWORD,
    });
    expect(other.statusCode).toBe(429);
    // The account itself is not locked, only the address it was attacked from.
    const [office] = await h.db.db
      .select()
      .from(users)
      .where(eq(users.email, OFFICE));
    expect(office?.lockedUntil).toBeNull();
  });
});

describe("GET /api/auth/me", () => {
  it("returns the signed-in user", async () => {
    const { cookie } = await login(h, HEAD);
    const res = await h.app.server.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.email).toBe(HEAD);
  });

  it("refuses an anonymous request", async () => {
    const res = await h.app.server.inject({
      method: "GET",
      url: "/api/auth/me",
    });
    expect(res.statusCode).toBe(401);
  });

  it("refuses a made-up session cookie", async () => {
    const res = await h.app.server.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie: "ams_session=not-a-real-token" },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe("sessions expire", () => {
  it("stops working after 8 hours of inactivity", async () => {
    const { cookie } = await login(h, HEAD);
    h.setNow(new Date(T0.getTime() + SESSION_IDLE_MS + 1000));
    const res = await h.app.server.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(401);
  });

  it("stops working 12 hours after issue even when used continuously", async () => {
    const { cookie } = await login(h, HEAD);
    // Use it every few hours so the idle timer never trips.
    for (const hours of [4, 8, 11]) {
      h.setNow(new Date(T0.getTime() + hours * 3_600_000));
      const ok = await h.app.server.inject({
        method: "GET",
        url: "/api/auth/me",
        headers: { cookie },
      });
      expect(ok.statusCode, `at ${hours}h`).toBe(200);
    }
    h.setNow(new Date(T0.getTime() + SESSION_ABSOLUTE_MS));
    const res = await h.app.server.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(401);
  });

  it("stops working the moment the user is deactivated", async () => {
    const { cookie } = await login(h, HEAD);
    await h.db.db
      .update(users)
      .set({ isActive: false })
      .where(eq(users.email, HEAD));
    const res = await h.app.server.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe("CSRF", () => {
  it("rejects a state-changing request with no CSRF header", async () => {
    const { cookie } = await login(h, HEAD);
    const res = await post("/api/auth/logout", undefined, { cookie });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("csrf_failed");
  });

  it("rejects a mismatched CSRF token", async () => {
    const { cookie } = await login(h, HEAD);
    const res = await post("/api/auth/logout", undefined, {
      cookie,
      "x-csrf-token": "wrong",
    });
    expect(res.statusCode).toBe(403);
  });

  it("rejects another session's CSRF token", async () => {
    const a = await login(h, HEAD);
    const b = await login(h, OFFICE);
    const res = await post("/api/auth/logout", undefined, {
      cookie: a.cookie,
      "x-csrf-token": b.csrfToken,
    });
    expect(res.statusCode).toBe(403);
  });

  it("accepts the matching token", async () => {
    const { cookie, csrfToken } = await login(h, HEAD);
    const res = await post("/api/auth/logout", undefined, {
      cookie,
      "x-csrf-token": csrfToken,
    });
    expect(res.statusCode).toBe(200);
  });

  it("does not require a token for reads", async () => {
    const { cookie } = await login(h, HEAD);
    const res = await h.app.server.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
  });
});

describe("POST /api/auth/logout", () => {
  it("revokes the session so the cookie stops working", async () => {
    const { cookie, csrfToken } = await login(h, HEAD);
    await post("/api/auth/logout", undefined, {
      cookie,
      "x-csrf-token": csrfToken,
    });
    const res = await h.app.server.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(401);
  });

  it("records the logout", async () => {
    const { cookie, csrfToken } = await login(h, HEAD);
    await post("/api/auth/logout", undefined, {
      cookie,
      "x-csrf-token": csrfToken,
    });
    const entries = await h.db.db.select().from(auditLog);
    expect(entries.map((e) => e.action)).toContain("logout");
  });
});

describe("POST /api/auth/change-password", () => {
  const NEW_PASSWORD = "copper kettle distant thunder";

  it("changes the password and lets the user sign in with the new one", async () => {
    const { cookie, csrfToken } = await login(h, HEAD);
    const res = await post(
      "/api/auth/change-password",
      { currentPassword: TEST_PASSWORD, newPassword: NEW_PASSWORD },
      { cookie, "x-csrf-token": csrfToken },
    );
    expect(res.statusCode).toBe(200);

    expect(
      (await post("/api/auth/login", { email: HEAD, password: TEST_PASSWORD }))
        .statusCode,
    ).toBe(401);
    expect(
      (await post("/api/auth/login", { email: HEAD, password: NEW_PASSWORD }))
        .statusCode,
    ).toBe(200);
  }, 30_000);

  it("invalidates every existing session, including other browsers", async () => {
    const first = await login(h, HEAD);
    const second = await login(h, HEAD);
    await post(
      "/api/auth/change-password",
      { currentPassword: TEST_PASSWORD, newPassword: NEW_PASSWORD },
      { cookie: first.cookie, "x-csrf-token": first.csrfToken },
    );
    for (const s of [first, second]) {
      const res = await h.app.server.inject({
        method: "GET",
        url: "/api/auth/me",
        headers: { cookie: s.cookie },
      });
      expect(res.statusCode).toBe(401);
    }
  }, 30_000);

  it("clears must_change_password", async () => {
    await h.db.db
      .update(users)
      .set({ mustChangePassword: true })
      .where(eq(users.email, HEAD));
    const { cookie, csrfToken } = await login(h, HEAD);
    await post(
      "/api/auth/change-password",
      { currentPassword: TEST_PASSWORD, newPassword: NEW_PASSWORD },
      { cookie, "x-csrf-token": csrfToken },
    );
    const [u] = await h.db.db.select().from(users).where(eq(users.email, HEAD));
    expect(u?.mustChangePassword).toBe(false);
  }, 30_000);

  it("refuses a wrong current password", async () => {
    const { cookie, csrfToken } = await login(h, HEAD);
    const res = await post(
      "/api/auth/change-password",
      { currentPassword: "not my password", newPassword: NEW_PASSWORD },
      { cookie, "x-csrf-token": csrfToken },
    );
    expect(res.statusCode).toBe(403);
  });

  it("refuses a weak new password and explains why", async () => {
    const { cookie, csrfToken } = await login(h, HEAD);
    const res = await post(
      "/api/auth/change-password",
      { currentPassword: TEST_PASSWORD, newPassword: "password123" },
      { cookie, "x-csrf-token": csrfToken },
    );
    expect(res.statusCode).toBe(422);
    expect(res.json().problems.join(" ")).toMatch(/commonly used/i);
  });

  it("refuses reusing the current password", async () => {
    const { cookie, csrfToken } = await login(h, HEAD);
    const res = await post(
      "/api/auth/change-password",
      { currentPassword: TEST_PASSWORD, newPassword: TEST_PASSWORD },
      { cookie, "x-csrf-token": csrfToken },
    );
    expect(res.statusCode).toBe(422);
    expect(res.json().problems.join(" ")).toMatch(/differ/i);
  }, 30_000);

  it("requires authentication", async () => {
    const res = await post("/api/auth/change-password", {
      currentPassword: TEST_PASSWORD,
      newPassword: NEW_PASSWORD,
    });
    expect(res.statusCode).toBe(401);
  });

  it("records the change without recording either password", async () => {
    const { cookie, csrfToken } = await login(h, HEAD);
    await post(
      "/api/auth/change-password",
      { currentPassword: TEST_PASSWORD, newPassword: NEW_PASSWORD },
      { cookie, "x-csrf-token": csrfToken },
    );
    const entries = await h.db.db.select().from(auditLog);
    expect(entries.map((e) => e.action)).toContain("password_change");
    const dump = JSON.stringify(entries);
    expect(dump).not.toContain(NEW_PASSWORD);
    expect(dump).not.toContain(TEST_PASSWORD);
  }, 30_000);
});
