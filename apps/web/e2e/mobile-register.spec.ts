import { expect, test } from "@playwright/test";
import { signIn } from "./helpers.js";

/**
 * The register on a phone.
 *
 * The document itself never scrolls — `body { overflow: hidden }`, because
 * every surface is meant to scroll on its own. A surface that is given
 * `overflow-y-auto` but no height therefore grows to the height of its
 * content and scrolls nothing, and everything past the first screen becomes
 * unreachable. That is what a whole school's worth of rows did on a phone:
 * five thousand pixels of register with no way to reach them.
 */

test.use({ viewport: { width: 375, height: 812 } });

test("a phone can scroll the whole register", async ({ page }) => {
  await signIn(page, "full");
  const root = page.locator("main > div > div").first();
  await expect(page.getByRole("heading", { name: "Live register" })).toBeVisible();

  const fits = await root.evaluate((el) => ({
    shown: el.clientHeight,
    content: el.scrollHeight,
    viewport: window.innerHeight,
  }));
  expect(
    fits.shown,
    `the register is ${fits.shown}px tall in a ${fits.viewport}px window, so nothing can scroll it`,
  ).toBeLessThanOrEqual(fits.viewport);
  expect(fits.content, "there is more register than fits").toBeGreaterThan(fits.shown);

  // And it genuinely moves: the bottom of the list is reachable.
  await root.evaluate((el) => el.scrollTo(0, el.scrollHeight));
  const reached = await root.evaluate((el) => el.scrollTop);
  expect(reached, "the list would not scroll").toBeGreaterThan(100);
});
