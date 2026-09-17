import { expect, test } from "@playwright/test";
import { DEMO, rowFor, signIn } from "./helpers.js";

/**
 * Specification §12: perform a manual adjustment and assert the audit entry
 * exists.
 *
 * The whole path is driven through the screen — open a person, correct the
 * day, give a reason — and then the audit log is read back through the
 * admin screen, the way somebody checking up on a correction would.
 */

const REASON = "Signed out at reception; the reader missed it (e2e).";

test("correcting a day writes an audit entry that the admin screen shows", async ({
  page,
}) => {
  await signIn(page, "full");

  await page.getByLabel("Search by name or ID").fill(DEMO.seededStudent);
  const row = rowFor(page, DEMO.seededStudent);
  await expect(row).toContainText("On site");
  await expect(row.getByLabel("Corrected by hand")).toHaveCount(0);

  await row.click();
  const panel = page.getByRole("dialog", { name: "Person detail" });
  await expect(panel).toBeVisible();
  await expect(panel).toContainText(DEMO.seededStudent);
  const personName = (await panel
    .getByRole("heading", { level: 2 })
    .textContent())!.trim();
  expect(personName.length).toBeGreaterThan(0);

  await panel.getByRole("button", { name: "Correct", exact: true }).click();
  await panel.getByLabel("Status").selectOption("departed");

  // A correction without a reason cannot be saved.
  const save = panel.getByRole("button", { name: "Save correction" });
  await expect(save).toBeDisabled();
  await panel.getByLabel("Reason").fill(REASON);
  await expect(save).toBeEnabled();
  await save.click();

  // The register row, the panel, and the hand-correction marker all update.
  await expect(row).toContainText("Departed");
  await expect(row.getByLabel("Corrected by hand")).toBeVisible();
  await expect(panel).toContainText(`Last corrected by ${DEMO.full.name}`);
  await expect(panel).toContainText(REASON);

  // Now the audit log, through the admin screen.
  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "Admin" })
    .click();
  await page
    .getByRole("navigation", { name: "Admin sections" })
    .getByRole("link", { name: "Audit log" })
    .click();
  await page.getByLabel("Filter by action").selectOption("manual_adjustment");

  const entry = page
    .getByRole("row")
    .filter({ hasText: "manual adjustment" })
    .first();
  await expect(entry).toBeVisible();
  await expect(entry).toContainText(DEMO.full.name);
  await expect(entry).toContainText("day_record");

  await entry.getByRole("button", { name: "Detail" }).click();
  const detail = entry.locator("pre");
  await expect(detail).toContainText('"departed"');
  await expect(detail).toContainText(REASON);

  // And the API agrees, with the log's own filter — no screen in between.
  const audit = await page.request.get(
    "/api/admin/audit?action=manual_adjustment",
  );
  expect(audit.status()).toBe(200);
  const { entries } = (await audit.json()) as {
    entries: Array<{ action: string; entity: string | null; after: unknown }>;
  };
  expect(entries.length).toBeGreaterThanOrEqual(1);
  expect(entries[0]!.action).toBe("manual_adjustment");
  expect(entries[0]!.entity).toBe("day_record");
  expect(JSON.stringify(entries[0]!.after)).toContain(REASON);
});
