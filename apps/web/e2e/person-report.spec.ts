import { expect, test } from "@playwright/test";
import { DEMO, signIn } from "./helpers.js";

/**
 * The per-person report: reached from the school-wide table with the same
 * range, showing figures that agree with that table, with a day-by-day
 * record underneath and an export named by number rather than by name.
 */

test("a person's report is reached from the table and agrees with it", async ({
  page,
}) => {
  await signIn(page, "full");
  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "Reports" })
    .click();

  const tableRow = page
    .getByRole("row")
    .filter({ has: page.getByText(DEMO.reportStudent, { exact: true }) });
  await expect(tableRow).toBeVisible();
  // The columns are read by their headings rather than counted: the
  // Category column is there only when someone in the report has one.
  const headings = await page.getByRole("columnheader").allTextContents();
  const cells = await tableRow.getByRole("cell").allTextContents();
  expect(cells).toHaveLength(headings.length);
  const column = (label: string) => {
    const at = headings.findIndex((h) => h.trim().startsWith(label));
    expect(at, `a "${label}" column`).toBeGreaterThanOrEqual(0);
    return cells[at]!;
  };
  const name = column("Name");
  const present = column("Present");
  const absent = column("Absent");
  const late = column("Late");
  const attendance = column("Attendance");

  const from = await page.getByLabel("From").inputValue();
  const to = await page.getByLabel("To").inputValue();

  await tableRow.getByRole("link").click();
  await expect(page).toHaveURL(new RegExp(`/reports/person/[0-9a-f-]+\\?from=${from}&to=${to}`));

  await expect(page.getByRole("heading", { level: 1 })).toContainText(name);
  await expect(
    page.getByText(DEMO.reportStudent, { exact: false }).filter({ visible: true }),
  ).toBeVisible();

  const tile = (label: string) =>
    page.getByRole("group", { name: label, exact: true });
  await expect(tile("Present")).toContainText(present);
  await expect(tile("Absent")).toContainText(absent);
  await expect(tile("Late")).toContainText(late);
  await expect(tile("Attendance")).toContainText(attendance);

  // A day-by-day row for today, with the arrival the register shows.
  await expect(page.getByRole("row").filter({ hasText: "Present" }).first()).toBeVisible();

  // The export carries the same range and is named by enrolment number.
  const href = await page.getByRole("link", { name: "Export CSV" }).getAttribute("href");
  expect(href).toContain(`from=${from}&to=${to}&format=csv`);
  const csv = await page.request.get(href!);
  expect(csv.status()).toBe(200);
  expect(csv.headers()["content-disposition"]).toContain(
    `attendance-${DEMO.reportStudent}-${from}-to-${to}.csv`,
  );
  expect(csv.headers()["content-disposition"]).not.toContain(name.split(" ")[0]!);

  // Back to the table with the range intact.
  await page.getByRole("link", { name: "All people" }).click();
  await expect(page).toHaveURL(new RegExp(`/reports\\?from=${from}&to=${to}`));
});
