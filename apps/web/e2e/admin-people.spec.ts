import { expect, test } from "@playwright/test";
import { rowFor, signIn } from "./helpers.js";

/**
 * One person, by hand: added, seen on the register, edited, deactivated.
 * The spreadsheet import is for the whole school; this is the path for the
 * one new pupil in October, and it has to be as complete.
 */

test("a person can be added by hand, edited, and deactivated", async ({
  page,
}) => {
  await signIn(page, "full");
  await page.goto("/admin/people");

  const enrollNo = `77${String(Date.now()).slice(-5)}`;
  const name = `Test Pupil ${enrollNo}`;

  await page.getByRole("button", { name: "Add person" }).click();
  const dialog = page.getByRole("dialog", { name: "Add a person" });
  await dialog.getByLabel("Enrolment number").fill(enrollNo);
  await dialog.getByLabel("Full name").fill(name);
  await dialog.getByLabel("Group").selectOption({ label: "Form 1" });
  await dialog.getByRole("button", { name: "Add person" }).click();
  await expect(dialog).toBeHidden();

  // In the directory, with the group.
  await page.getByLabel("Search people").fill(enrollNo);
  const listed = rowFor(page, enrollNo);
  await expect(listed).toContainText(name);
  await expect(listed).toContainText("Form 1");

  // And on the register, where it counts.
  await page.goto(`/register?q=${enrollNo}`);
  await expect(rowFor(page, enrollNo)).toContainText(name);

  // Edited in place; the number cannot be changed.
  await page.goto("/admin/people");
  await page.getByLabel("Search people").fill(enrollNo);
  await listed.getByRole("button", { name: `Actions for ${name}` }).click();
  await page.getByRole("menuitem", { name: "Edit" }).click();
  const edit = page.getByRole("dialog", { name: "Edit person" });
  await expect(edit.getByLabel("Enrolment number")).toBeDisabled();
  await edit.getByLabel("Full name").fill(`${name} Renamed`);
  await edit.getByRole("button", { name: "Save" }).click();
  await expect(edit).toBeHidden();
  await expect(rowFor(page, enrollNo)).toContainText(`${name} Renamed`);

  // Deactivated: gone from the list and the register, kept with history.
  await rowFor(page, enrollNo)
    .getByRole("button", { name: `Actions for ${name} Renamed` })
    .click();
  await page.getByRole("menuitem", { name: "Deactivate" }).click();
  await expect(rowFor(page, enrollNo)).toHaveCount(0);
  await page.getByLabel("Show deactivated").check();
  await expect(rowFor(page, enrollNo)).toContainText("Inactive");

  await page.goto(`/register?q=${enrollNo}`);
  await expect(page.getByText("No one matches these filters.")).toBeVisible();
});
