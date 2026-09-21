import { expect, test } from "@playwright/test";
import { DEMO, rowFor, signIn } from "./helpers.js";

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
  await dialog.getByLabel("Category").fill("Exchange");
  await dialog.getByRole("button", { name: "Add person" }).click();
  await expect(dialog).toBeHidden();

  // In the directory, with the group and the category.
  await page.getByLabel("Search people").fill(enrollNo);
  const listed = rowFor(page, enrollNo);
  await expect(listed).toContainText(name);
  await expect(listed).toContainText("Form 1");
  await expect(listed).toContainText("Exchange");

  // And on the register, where it counts, the category beside the group.
  await page.goto(`/register?q=${enrollNo}&status=any`);
  await expect(rowFor(page, enrollNo)).toContainText(name);
  await expect(rowFor(page, enrollNo)).toContainText("Exchange");

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

  // "Show deactivated" is the leavers alone, not the school with them mixed in.
  await page.getByLabel("Search people").fill("");
  await page.getByLabel("Show deactivated").check();
  await expect(rowFor(page, enrollNo)).toContainText("Inactive");
  await expect(rowFor(page, DEMO.seededStudent)).toHaveCount(0);

  await page.goto(`/register?q=${enrollNo}&status=any`);
  await expect(page.getByText("No one matches these filters.")).toBeVisible();

  // Deleted: asked twice, then gone for good.
  await page.goto("/admin/people");
  await page.getByLabel("Show deactivated").check();
  await page.getByLabel("Search people").fill(enrollNo);
  await rowFor(page, enrollNo)
    .getByRole("button", { name: `Actions for ${name} Renamed` })
    .click();
  await page.getByRole("menuitem", { name: "Delete…" }).click();
  const confirm = page.getByRole("dialog", { name: `Delete ${name} Renamed?` });
  await expect(confirm).toContainText("cannot be undone");
  await confirm.getByRole("button", { name: "Delete permanently" }).click();
  await expect(page.getByText(`${name} Renamed deleted`)).toBeVisible();
  await expect(rowFor(page, enrollNo)).toHaveCount(0);
  const all = (await (
    await page.request.get(`/api/admin/people?active=all&q=${enrollNo}`)
  ).json()) as { total: number };
  expect(all.total).toBe(0);
});

test("the directory filters by branch, group and tutor", async ({ page }) => {
  await signIn(page, "full");
  await page.goto("/admin/people");

  await page.getByLabel("Branch").selectOption("staff");
  await expect(page.getByRole("row").filter({ hasText: "Form 1" })).toHaveCount(0);
  await expect(
    page.getByRole("row").filter({ hasText: "Junior Staff" }).first(),
  ).toBeVisible();

  await page.getByLabel("Branch").selectOption("");
  await page.getByLabel("Group").selectOption({ label: "Form 1" });
  await expect(rowFor(page, DEMO.seededStudent)).toHaveCount(0);
  await expect(page.getByRole("row").filter({ hasText: "Form 2" })).toHaveCount(0);

  await page.getByLabel("Group").selectOption("");
  const tutors = (await (await page.request.get("/api/admin/tutors")).json()) as {
    tutors: Array<{ id: number; initials: string }>;
  };
  const rj = tutors.tutors.find((t) => t.initials === "RJ")!;
  await page.getByLabel("Tutor").selectOption(String(rj.id));
  // Ann Fernando's tutor is AP; Ben Fernando's is RJ.
  await expect(rowFor(page, "11040")).toHaveCount(0);
  await expect(rowFor(page, "11041")).toBeVisible();
});

test("tutors are added, named and removed by hand", async ({ page }) => {
  await signIn(page, "full");
  await page.goto("/admin/people");
  await page.getByRole("button", { name: "Tutors" }).click();
  const dialog = page.getByRole("dialog", { name: "Tutors" });

  const initials = `Z${String(Date.now()).slice(-3)}`;
  await dialog.getByLabel("New tutor initials").fill(initials.toLowerCase());
  await dialog.getByLabel("New tutor name").fill("Z. Test");
  await dialog.getByLabel("New tutor name").press("Enter");
  await expect(page.getByText(`Tutor ${initials} added`)).toBeVisible();
  const row = dialog.getByRole("row").filter({ hasText: initials });
  await expect(row).toContainText("0");

  // A tutor with people cannot be removed; one without can.
  await expect(
    dialog.getByRole("button", { name: "Remove tutor AP" }),
  ).toBeDisabled();
  await dialog.getByRole("button", { name: `Remove tutor ${initials}` }).click();
  await expect(page.getByText(`Tutor ${initials} removed`)).toBeVisible();
  await expect(row).toHaveCount(0);
});
