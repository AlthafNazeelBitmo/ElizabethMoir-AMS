import { expect, test } from "@playwright/test";
import { signIn } from "./helpers.js";

/**
 * Specification §12: apply filters and assert URL state survives a reload.
 *
 * The filters live in the URL so a view can be bookmarked and sent to a
 * colleague. The check is therefore not "the state is still in memory" but
 * "the URL alone reproduces the view" — the page is reloaded, and everything
 * it shows must come back from the address bar.
 */

test("group, status and search filters live in the URL and survive a reload", async ({
  page,
}) => {
  await signIn(page, "full");

  const rail = page.getByRole("navigation", { name: "Groups" });
  const status = page.getByLabel("Status");
  const search = page.getByLabel("Search by name or ID");

  await rail.getByRole("button", { name: /^Form 1\b/ }).click();
  await expect(page).toHaveURL(/branch=student/);
  await expect(page).toHaveURL(/group=\d+/);

  await status.selectOption("on_site");
  await expect(page).toHaveURL(/status=on_site/);

  await search.fill("Perera");
  await expect(page).toHaveURL(/q=Perera/);

  const before = new URL(page.url()).searchParams;
  const groupId = before.get("group");
  expect(groupId).not.toBeNull();

  // The rows shown honour all three filters at once.
  const rows = page.getByRole("row").filter({ hasText: "Perera" });
  await expect(rows.first()).toBeVisible();
  const count = await rows.count();
  for (let i = 0; i < count; i++) {
    await expect(rows.nth(i)).toContainText("Form 1");
    await expect(rows.nth(i)).toContainText("On site");
  }
  expect(await page.getByRole("row").count()).toBe(count + 1); // + header

  await page.reload();

  // Everything the URL carried is back on screen without a click.
  const after = new URL(page.url()).searchParams;
  expect(after.get("branch")).toBe("student");
  expect(after.get("group")).toBe(groupId);
  expect(after.get("status")).toBe("on_site");
  expect(after.get("q")).toBe("Perera");

  await expect(status).toHaveValue("on_site");
  await expect(search).toHaveValue("Perera");
  await expect(rail.getByRole("button", { name: /^Form 1\b/ })).toHaveAttribute(
    "aria-current",
    "true",
  );
  await expect(page.getByRole("button", { name: "On site" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  const rowsAfter = page.getByRole("row").filter({ hasText: "Perera" });
  await expect(rowsAfter).toHaveCount(count);
  await expect(rowsAfter.first()).toContainText("Form 1");

  // And clearing leaves a clean URL, so a bookmark of "/register" is the
  // unfiltered view and nothing else.
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page).toHaveURL(/\/register$/);
  await expect(search).toHaveValue("");
  await expect(status).toHaveValue("");
});

test("a date in the URL is honoured and survives a reload", async ({
  page,
}) => {
  await signIn(page, "full");

  const date = page.getByLabel("Date");
  const yesterday = await date.evaluate((el: HTMLInputElement) => {
    const d = new Date(`${el.value}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  });

  await date.fill(yesterday);
  await expect(page).toHaveURL(new RegExp(`date=${yesterday}`));

  await page.reload();
  await expect(date).toHaveValue(yesterday);
  await expect(page).toHaveURL(new RegExp(`date=${yesterday}`));
  // A settled day is not live, and the page must not pretend otherwise.
  await expect(page.getByText("Not live", { exact: true })).toBeVisible();
  await expect(page.getByText("Live", { exact: true })).toHaveCount(0);
});
