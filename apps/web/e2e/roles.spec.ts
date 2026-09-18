import { expect, test } from "@playwright/test";
import { DEMO, schoolNow, signIn } from "./helpers.js";

/**
 * Specification §12: log in as each role and verify the visible navigation.
 *
 * Hidden navigation is a courtesy; the server is the control. So each role
 * is checked both ways: what the page shows, and what the API answers when
 * asked directly for something the role must not have.
 */

test("an unauthenticated visitor is sent to the sign-in page", async ({
  page,
}) => {
  await page.goto("/register");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
});

test("a wrong password is told so, not that a session ended", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(DEMO.full.email);
  await page.getByLabel("Password").fill("not the password at all");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toContainText("was not recognised");
  await expect(page.getByRole("alert")).not.toContainText("session has ended");
});

test("a full account sees students, staff and admin", async ({ page }) => {
  await signIn(page, "full");

  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(nav.getByRole("link", { name: "Live register" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Reports" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Admin" })).toBeVisible();

  const rail = page.getByRole("navigation", { name: "Groups" });
  await expect(
    rail.getByRole("button", { name: "All students" }),
  ).toBeVisible();
  await expect(rail.getByRole("button", { name: "All staff" })).toBeVisible();

  await expect(page.getByText(DEMO.full.name)).toBeVisible();

  // Admin is reachable, and its sections are all there.
  await nav.getByRole("link", { name: "Admin" }).click();
  const sections = page.getByRole("navigation", { name: "Admin sections" });
  for (const label of [
    "People",
    "Unknown IDs",
    "Devices",
    "Calendar",
    "Rules",
    "Users",
    "Audit log",
    "Failed events",
  ]) {
    await expect(sections.getByRole("link", { name: label, exact: true })).toBeVisible();
  }
});

test("a student-only account sees no staff and no admin, anywhere", async ({
  page,
}) => {
  await signIn(page, "studentOnly");

  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(nav.getByRole("link", { name: "Live register" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Reports" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Admin" })).toHaveCount(0);

  const rail = page.getByRole("navigation", { name: "Groups" });
  await expect(
    rail.getByRole("button", { name: "All students" }),
  ).toBeVisible();
  await expect(rail.getByRole("button", { name: "All staff" })).toHaveCount(0);
  await expect(rail.getByRole("button", { name: /Staff/ })).toHaveCount(0);

  await expect(page.getByText(/students only/i)).toBeVisible();

  // Now the part that matters: the API, asked directly with this session's
  // cookies. The page hiding a link proves nothing on its own.
  const { date } = schoolNow();

  const staff = await page.request.get(
    `/api/register/live?date=${date}&branch=staff`,
  );
  expect(staff.status()).toBe(200);
  expect((await staff.json()).rows).toEqual([]);

  const everyone = await page.request.get(`/api/register/live?date=${date}`);
  const groups = new Set(
    ((await everyone.json()).rows as Array<{ groupName: string | null }>).map(
      (r) => r.groupName,
    ),
  );
  expect(groups.has("Junior Staff")).toBe(false);
  expect(groups.has("External Staff")).toBe(false);

  const audit = await page.request.get("/api/admin/audit");
  expect(audit.status()).toBe(403);

  const users = await page.request.get("/api/admin/users");
  expect(users.status()).toBe(403);
});
