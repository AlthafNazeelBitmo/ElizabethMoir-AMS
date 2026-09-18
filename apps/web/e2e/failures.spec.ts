import { expect, test } from "@playwright/test";
import { DEMO, signIn } from "./helpers.js";

/**
 * A delivery that cannot be read waits under Failed events, and Replay
 * re-runs it through the screen. Replay carries no body: it must reach the
 * server as a plain POST, not be refused for an empty JSON body before the
 * route ever runs — which is how it failed for months without anyone
 * pressing it.
 */

test("a failed delivery is listed and can be replayed from the screen", async ({
  page,
}) => {
  await signIn(page, "full");

  // A delivery the reader would never send: plain text where JSON is due.
  const posted = await page.request.post(DEMO.ingestPath, {
    headers: { "content-type": "text/plain" },
    data: `not json ${Date.now()}`,
  });
  expect(posted.status()).toBe(200);

  await page.goto("/admin/failures");
  const row = page.getByRole("row").filter({ hasText: "not an array" }).first();
  await expect(row).toBeVisible();

  await row.getByRole("button", { name: "Replay" }).click();
  // Still unreadable — but the server said so, rather than refusing the call.
  await expect(page.getByText("Still failing")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);

  // It will never succeed, so it is set aside: out of the working list,
  // kept with a name against it, and back with one click.
  await row.getByRole("button", { name: "Dismiss" }).click();
  await expect(page.getByText("Set aside", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("row").filter({ hasText: "not an array" }),
  ).toHaveCount(0);

  await page.getByLabel("Show dismissed").check();
  const dismissed = page
    .getByRole("row")
    .filter({ hasText: "Dismissed by Head Teacher" })
    .first();
  await expect(dismissed).toBeVisible();
  await dismissed.getByRole("button", { name: "Restore" }).click();
  await expect(page.getByText("Back in the list")).toBeVisible();
  const restored = page.getByRole("row").filter({ hasText: "not an array" }).first();
  await expect(restored).not.toContainText("Dismissed");
  await expect(restored.getByRole("button", { name: "Replay" })).toBeVisible();
});
