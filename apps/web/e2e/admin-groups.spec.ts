import { expect, test } from "@playwright/test";
import { signIn } from "./helpers.js";

/**
 * The group-management screen, end to end: a group added here is listed,
 * audited with the actor, and really stored; a name clash is refused in
 * words, not with a blank stare.
 */

test("an administrator can add a group, and the change is audited", async ({
  page,
}) => {
  await signIn(page, "full");
  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "Admin" })
    .click();
  await page
    .getByRole("navigation", { name: "Admin sections" })
    .getByRole("link", { name: "Groups", exact: true })
    .click();

  // Seeded groups are listed with how many people they hold.
  const form1 = page.getByRole("row").filter({
    has: page.getByLabel("Name of Form 1"),
  });
  await expect(form1).toContainText("30");

  await page.getByRole("button", { name: "Add group" }).click();

  // A clash is refused, whatever the case.
  await page.getByLabel("Name", { exact: true }).fill("form 1");
  await page.getByRole("button", { name: "Add group" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "already a group called form 1",
  );

  const name = `Year ${Date.now() % 100000}`;
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByRole("button", { name: "Add group" }).click();
  await expect(page.getByLabel(`Name of ${name}`)).toBeVisible();

  // Audited, with the actor.
  await page
    .getByRole("navigation", { name: "Admin sections" })
    .getByRole("link", { name: "Audit log" })
    .click();
  await page.getByLabel("Filter by action").selectOption("group_created");
  await expect(
    page.getByRole("row").filter({ hasText: "group created" }).first(),
  ).toContainText("Head Teacher");

  // And it is really there, not just in this page's memory.
  const groups = (await (await page.request.get("/api/admin/groups")).json())
    .groups as Array<{ name: string; peopleCount: number }>;
  expect(groups.find((g) => g.name === name)).toMatchObject({
    peopleCount: 0,
  });
});
