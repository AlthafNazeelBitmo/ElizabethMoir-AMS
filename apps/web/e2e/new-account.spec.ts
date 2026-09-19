import { expect, test } from "@playwright/test";
import { signIn } from "./helpers.js";

/**
 * A new account's first day, as the person lives it: an administrator
 * creates it and reads the temporary password; the person signs in with
 * it, is made to choose their own, is told the change worked, and signs
 * in again with the new one. The temporary password no longer works after
 * that, and the screen says so in words rather than blaming a session.
 */

test("a new account signs in with its temporary password and replaces it", async ({
  page,
}) => {
  await signIn(page, "full");
  await page.goto("/admin/users");

  const email = `new.${Date.now()}@school.example`;
  await page.getByRole("button", { name: "Add user" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Full name").fill("Newly Added");
  await page.getByRole("button", { name: "Create" }).click();

  const shown = page.getByText("Temporary password");
  await expect(shown).toBeVisible();
  const temporary = (await page
    .locator("p.font-mono", { hasText: /^[a-z2-9-]{12,}$/ })
    .textContent())!.trim();
  expect(temporary.length).toBeGreaterThanOrEqual(12);

  // Out as the administrator, in as the new person.
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);
  // Signed out on the server too, not just sent to the sign-in page.
  expect((await page.request.get("/api/auth/me")).status()).toBe(401);

  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(temporary);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/change-password/);

  const chosen = "orchard lantern violet 2026";
  await page.getByLabel("Current password").fill(temporary);
  await page.getByLabel("New password").fill(chosen);
  await page.getByRole("button", { name: "Change password" }).click();

  // Back at sign-in, told why.
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("status")).toContainText("password was changed");

  // The temporary password is spent, and the refusal is honest about it.
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(temporary);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toContainText("not recognised");

  // The chosen one works, and the account is a student-only one by default.
  await page.getByLabel("Password", { exact: true }).fill(chosen);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/register/);
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
  await expect(
    page
      .getByRole("navigation", { name: "Main" })
      .getByRole("link", { name: "Admin" }),
  ).toHaveCount(0);
});
