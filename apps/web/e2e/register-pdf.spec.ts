import { expect, test } from "@playwright/test";
import { DEMO, signIn } from "./helpers.js";

/**
 * The day's register as a PDF, from the register itself.
 *
 * The button opens the browser's print dialogue, which cannot be driven
 * from a test; what is tested is the sheet it would print. That matters
 * because the screen's table is virtualised — printing it would print
 * the dozen rows in view — so the sheet is a plain table of its own, and
 * a person far down the list has to be on it.
 */

test("the printed register is the whole day, not the rows in view", async ({
  page,
}) => {
  await signIn(page, "full");
  await page.goto("/register?status=any");
  await expect(page.getByRole("table", { name: "Register" })).toBeVisible();

  await expect(
    page.getByRole("button", { name: "Download PDF" }),
  ).toBeVisible();

  const everyone = await page
    .getByRole("table", { name: "Register" })
    .getByRole("row")
    .count();

  await page.emulateMedia({ media: "print" });

  // The screen gives way to a sheet that explains itself.
  await expect(page.getByRole("table", { name: "Register" })).toBeHidden();
  await expect(page.getByRole("heading", { name: "Live register" })).toBeVisible();
  await expect(page.getByText("Prepared", { exact: false })).toBeVisible();
  await expect(page.getByText("Everyone · every status")).toBeVisible();

  // Every row, including one the virtualised table never rendered.
  const printed = page.locator("table").filter({ hasText: "Category" });
  await expect(printed).toBeVisible();
  const rows = await printed.getByRole("row").count();
  expect(rows).toBeGreaterThan(everyone);
  await expect(printed).toContainText(DEMO.seededStudent);

  // The day's figures stand above the table, where the tiles are on screen.
  const figures = page.locator("dl").filter({ hasText: "Expected" });
  await expect(figures).toBeVisible();
  await expect(figures).toContainText("Present");
  await expect(figures).toContainText("Absent");

  await page.emulateMedia({ media: null });
});
