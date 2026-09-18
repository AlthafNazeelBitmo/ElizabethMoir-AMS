import { expect, test } from "@playwright/test";
import { signIn } from "./helpers.js";

/**
 * The school's crest: uploaded once under Rules, shown in the sidebar at
 * once, and on the sign-in page before there is any session. Removed, the
 * initials tile stands in again.
 */

const CREST = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#2aa7cf"/></svg>`,
);

test("the crest is uploaded under Rules and appears in the shell and at sign-in", async ({
  page,
}) => {
  await signIn(page, "full");
  await page.goto("/admin/rules");

  await page.getByLabel("Choose a mark").setInputFiles({
    name: "crest.svg",
    mimeType: "image/svg+xml",
    buffer: CREST,
  });
  await expect(page.getByText("Mark updated")).toBeVisible();
  await expect(page.getByRole("button", { name: "Replace" })).toBeVisible();

  // The shell shows it (an image, not the initials tile), served by the API.
  const shellMark = page.locator("aside img[src^='/api/school/logo']").first();
  await expect(shellMark).toBeVisible();
  const served = await page.request.get("/api/school/logo");
  expect(served.status()).toBe(200);
  expect(served.headers()["content-type"]).toContain("image/svg+xml");

  // Before a session exists, the sign-in page shows it too.
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);
  await expect(page.locator("form img[src^='/api/school/logo']")).toBeVisible();

  // Removed: the tile is back, and the API says there is none.
  await signIn(page, "full");
  await page.goto("/admin/rules");
  await page.getByRole("button", { name: "Remove" }).click();
  await expect(page.getByText("Mark removed")).toBeVisible();
  await expect(page.getByRole("button", { name: "Upload" })).toBeVisible();
  expect((await page.request.get("/api/school/logo")).status()).toBe(404);
});
