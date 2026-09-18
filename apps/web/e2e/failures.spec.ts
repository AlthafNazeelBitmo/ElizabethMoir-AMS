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
});
