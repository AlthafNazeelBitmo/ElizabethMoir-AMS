import { expect, test } from "@playwright/test";
import { DEMO, rowFor, schoolNow, signIn } from "./helpers.js";

/**
 * Specification §12: post a scan and assert it appears in the register
 * without a refresh.
 *
 * "Without a refresh" is asserted, not assumed: the test counts requests to
 * the register endpoint and requires none after the scan is posted. The row
 * must change because the event stream delivered it, not because something
 * refetched. The counter is attached before the page loads, so it has been
 * seen to count a real fetch before it is trusted to report none.
 */

test("a posted scan reaches the open register through the stream", async ({
  page,
}) => {
  let registerFetches = 0;
  page.on("request", (request) => {
    if (/\/api\/register\/live\b/.test(request.url())) registerFetches += 1;
  });

  await signIn(page, "full");

  // Narrow the view to the one person, so the row is on screen regardless
  // of how the virtualised table has laid out the rest. Search is applied
  // in the browser, so this is not a fetch.
  await page.getByLabel("Search by name or ID").fill(DEMO.unscannedStudent);
  const row = rowFor(page, DEMO.unscannedStudent);
  await expect(row).toBeVisible();
  await expect(row).not.toContainText("On site");

  // Wait for the stream to be live before posting; a scan delivered before
  // the subscription is replayed on connect, which would also pass but
  // would not be the behaviour under test.
  await expect(page.getByText("Live", { exact: true })).toBeVisible();

  expect(registerFetches).toBeGreaterThanOrEqual(1);
  const fetchesBeforeScan = registerFetches;

  // The scan is stamped with the school's current time, as a reader would.
  // Between 00:00 and 03:00 Colombo the day rollover files it under the
  // previous school day, which today's register does not show. A school
  // register is not watched at that hour; the test says so rather than
  // failing for a reason that has nothing to do with the stream.
  const { date, time } = schoolNow();
  test.skip(
    Number(time.slice(0, 2)) < 3,
    `It is ${time} at the school: a scan now belongs to yesterday's day.`,
  );
  const response = await page.request.post(DEMO.ingestPath, {
    data: [
      {
        EmpId: DEMO.unscannedStudent,
        AttTime: `${date} ${time}`,
        CheckingStatus: "0",
        VerifyType: "1",
        DeviceID: DEMO.device,
      },
    ],
  });
  expect(response.status()).toBe(200);

  await expect(row).toContainText("On site");
  await expect(row).toContainText(time.slice(0, 5));
  expect(registerFetches).toBe(fetchesBeforeScan);
});
