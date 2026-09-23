import { expect, test } from "@playwright/test";
import { DEMO, rowFor, signIn } from "./helpers.js";

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
    await expect(rows.nth(i)).toContainText("Present");
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
  await expect(page.getByRole("button", { name: "Present" })).toHaveAttribute(
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
  // The resting view is the people who have checked in, not the whole roll.
  await expect(status).toHaveValue("checked_in");
});

test("the register rests on who has checked in, and can show everyone", async ({
  page,
}) => {
  await signIn(page, "full");
  const status = page.getByLabel("Status");
  await expect(status).toHaveValue("checked_in");

  // Someone who has not scanned today is not on the resting view…
  await page.getByLabel("Search by name or ID").fill(DEMO.unscannedStudent);
  await expect(rowFor(page, DEMO.unscannedStudent)).toHaveCount(0);
  await expect(page.getByText("Nobody checked in matches")).toBeVisible();

  // …and one click away.
  await page.getByRole("button", { name: "Show everyone" }).click();
  await expect(page).toHaveURL(/status=any/);
  await expect(status).toHaveValue("any");
  await expect(rowFor(page, DEMO.unscannedStudent)).toBeVisible();
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

test("a form is narrowed to one of its own categories", async ({ page }) => {
  await signIn(page, "full");
  await page.goto("/register?status=any");

  const rail = page.getByRole("navigation", { name: "Groups" });
  const category = page.getByLabel("Category");
  // "30 people", or "8 of 30 people" when something is filtered locally.
  // A span: the printed header, which is in the document but not on the
  // screen, says the same thing in a div.
  const shown = page
    .locator("span")
    .filter({ hasText: /^\d[\d,]*( of [\d,]+)? (person|people)$/ });

  // Everyone: the forms' codes in the school's order, then the staff's —
  // never alphabetically across the school, where Form 3's SE would land
  // among the staff categories.
  await expect(category.locator("option")).toHaveText([
    "All categories",
    "DG",
    "HP",
    "LDS",
    "LG",
    "KR",
    "KT",
    "HOD",
    "Teaching",
    "Part-Time",
  ]);
  await expect(category.locator("optgroup").first()).toHaveAttribute(
    "label",
    "Form 1",
  );

  await rail.getByRole("button", { name: /^Form 1\b/ }).click();
  const whole = await shown.textContent();

  // The choices are the form's own; Form 2's are not offered here.
  await expect(category).toBeVisible();
  await expect(category.locator("option")).toHaveText([
    "All categories",
    "DG",
    "HP",
  ]);

  await category.selectOption("DG");
  await expect(page).toHaveURL(/category=DG/);
  await expect(shown).not.toHaveText(whole!);

  // The list is DG alone, and the figures above it agree.
  const rows = page.getByRole("table", { name: "Register" }).getByRole("row");
  const listed = (await rows.count()) - 1; // the header
  expect(listed).toBeGreaterThan(0);
  const expected = page.getByRole("button").filter({ hasText: "Expected" });
  await expect(expected).toContainText(String(listed));

  // Moving to another form drops a code that means nothing there.
  await rail.getByRole("button", { name: /^Form 2\b/ }).click();
  await expect(page).not.toHaveURL(/category=/);
  await expect(category.locator("option")).toHaveText([
    "All categories",
    "LDS",
    "LG",
  ]);
});
