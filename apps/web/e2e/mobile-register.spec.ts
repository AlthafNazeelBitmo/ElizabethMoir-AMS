import { expect, test } from "@playwright/test";
import { signIn } from "./helpers.js";

/**
 * The register on a phone.
 *
 * The document itself never scrolls — `body { overflow: hidden }`, because
 * every surface is meant to scroll on its own. A surface given
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

/**
 * And nothing hangs off the side of it. The header's actions could neither
 * shrink nor wrap, so on a phone the day picker and the download button ran
 * fifty pixels past the edge and took the whole page sideways with them.
 * Wide tables elsewhere are allowed their own sideways scroll; the register
 * on a phone is a list of cards and should need none.
 */
test("nothing on the register runs off the side of a phone", async ({ page }) => {
  await signIn(page, "full");
  await expect(page.getByRole("heading", { name: "Live register" })).toBeVisible();

  const over = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    return Array.from(document.querySelectorAll("body *"))
      .filter((el) => {
        const b = el.getBoundingClientRect();
        return b.width > 0 && b.right > vw + 1;
      })
      .map((el) => el.tagName + "." + String(el.className).slice(0, 40))
      .slice(0, 3);
  });
  expect(over, "these run past the right edge: " + over.join(" | ")).toEqual([]);
});
