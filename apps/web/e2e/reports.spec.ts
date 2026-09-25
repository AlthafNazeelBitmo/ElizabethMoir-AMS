import { expect, test } from "@playwright/test";
import { signIn } from "./helpers.js";

/**
 * The report over a range, narrowed the way the register is: by group and
 * by the form's own category. What is on the screen, what the export
 * carries and what the printed sheet says it covers must be one thing.
 */

test("a report is narrowed to a form's category, and says so", async ({
  page,
}) => {
  await signIn(page, "full");
  await page.goto("/reports");

  const group = page.getByLabel("Group");
  const category = page.getByLabel("Category");
  const rows = page.getByRole("row");

  await expect(page.getByRole("cell", { name: /^All \d+ people$/ })).toBeVisible();
  const everyone = await rows.count();

  await group.selectOption({ label: "Form 1" });
  await expect(page).toHaveURL(/group=\d+/);

  // The codes offered are that form's own.
  await expect(category.locator("option")).toHaveText([
    "All categories",
    "DG",
    "HP",
  ]);

  await category.selectOption("DG");
  await expect(page).toHaveURL(/category=DG/);
  // The table is refetched; count it once it is back, not mid-flight.
  const totals = page.getByRole("cell", { name: /^All \d+ people$/ });
  await expect(totals).toBeVisible();
  await expect(totals).not.toHaveText(`All ${everyone - 2} people`);
  const narrowed = await rows.count();
  expect(narrowed).toBeLessThan(everyone);
  expect(narrowed).toBeGreaterThan(2); // the header and the totals row

  // Every row left is DG.
  const codes = await page
    .getByRole("row")
    .filter({ hasText: "Form 1" })
    .getByRole("cell")
    .nth(3)
    .allTextContents();
  expect(codes.every((c) => c.trim() === "DG")).toBe(true);

  // The export carries the filter, and the file says what it left out.
  const href = await page
    .getByRole("link", { name: "Export CSV" })
    .getAttribute("href");
  expect(href).toContain("category=DG");
  const csv = await page.request.get(href!);
  expect(csv.status()).toBe(200);
  expect(await csv.text()).toContain("Category: DG");

  // Changing the form drops a code that means nothing in the new one.
  await group.selectOption({ label: "Form 2" });
  await expect(page).not.toHaveURL(/category=/);
});
