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
  // in the browser, so this is not a fetch. They have not scanned today,
  // so the resting view — who has checked in — does not show them yet.
  await page.getByLabel("Search by name or ID").fill(DEMO.unscannedStudent);
  const row = rowFor(page, DEMO.unscannedStudent);
  await expect(page.getByText("Nobody checked in matches")).toBeVisible();
  await expect(row).toHaveCount(0);

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

  // The scan brings them on to the screen, through the stream alone.
  await expect(row).toBeVisible();
  await expect(row).toContainText("Present");
  await expect(row).toContainText(time.slice(0, 5));
  expect(registerFetches).toBe(fetchesBeforeScan);
});

test("the last person through the door is at the top of the register", async ({
  page,
}) => {
  const { date, time } = schoolNow();
  test.skip(
    Number(time.slice(0, 2)) < 3,
    `It is ${time} at the school: a scan now belongs to yesterday's day.`,
  );

  await signIn(page, "full");
  await expect(page.getByText("Live", { exact: true })).toBeVisible();
  const table = page.getByRole("table", { name: "Register" });
  const firstRow = table.getByRole("row").nth(1); // after the header
  await expect(firstRow).toBeVisible();

  // The register opens A–Z by surname, where a scan does not move a row.
  await expect(page.getByLabel("Order")).toHaveValue("surname");
  const alphabeticalTop = await firstRow.textContent();

  await page.getByLabel("Order").selectOption("latest");
  await expect(page).toHaveURL(/sort=latest/);

  // Two movements at the end of the day, so they are the latest whatever
  // the hour the test runs at: the seed's arrivals run to 08:50 and the
  // correction test writes 15:05, both later than "now" in the morning.
  const post = (enrollNo: string, at: string) =>
    page.request.post(DEMO.ingestPath, {
      data: [
        {
          EmpId: enrollNo,
          AttTime: `${date} ${at}`,
          CheckingStatus: "0",
          VerifyType: "1",
          DeviceID: DEMO.device,
        },
      ],
    });

  expect((await post(DEMO.unscannedStudent2, "23:50:00")).status()).toBe(200);
  await expect(firstRow).toContainText(DEMO.unscannedStudent2);
  await expect(firstRow).toContainText("Present");

  // The next one through the door takes the top from them.
  expect((await post(DEMO.unscannedStudent3, "23:51:00")).status()).toBe(200);
  await expect(firstRow).toContainText(DEMO.unscannedStudent3);
  await expect(table.getByRole("row").nth(2)).toContainText(DEMO.unscannedStudent2);

  // In the school's order they sit where the school lists them.
  await page.getByLabel("Order").selectOption("school");
  await expect(firstRow).not.toContainText(DEMO.unscannedStudent3);
  await expect(page).toHaveURL(/sort=school/);

  // And back to A–Z, where the two scans have not moved anybody.
  await page.getByLabel("Order").selectOption("surname");
  await expect(page).not.toHaveURL(/sort=/);
  await expect(firstRow).toHaveText(alphabeticalTop!);
});

test("late and left early are shown where the group is judged by them", async ({
  page,
}) => {
  const { date, time } = schoolNow();
  test.skip(
    Number(time.slice(0, 2)) < 3,
    `It is ${time} at the school: a scan now belongs to yesterday's day.`,
  );

  await signIn(page, "full");
  await expect(page.getByText("Live", { exact: true })).toBeVisible();

  const post = (enrollNo: string, at: string, out = false) =>
    page.request.post(DEMO.ingestPath, {
      data: [
        {
          EmpId: enrollNo,
          AttTime: `${date} ${at}`,
          CheckingStatus: out ? "1" : "0",
          VerifyType: "1",
          DeviceID: DEMO.device,
        },
      ],
    });

  // 10:20 is after the school's hour for a form, and after Junior
  // Staff's own 07:30; Senior Staff is given no hour at all.
  expect((await post(DEMO.unscannedStudent4, "10:20:00")).status()).toBe(200);
  expect((await post(DEMO.staffMember, "10:20:00")).status()).toBe(200);
  expect((await post(DEMO.staffNoHours, "10:20:00")).status()).toBe(200);

  // The list is virtualised, so each row is brought on screen by the
  // search before it is read.
  const search = page.getByLabel("Search by name or ID");
  await search.fill(DEMO.unscannedStudent4);
  const student = rowFor(page, DEMO.unscannedStudent4);
  await expect(student).toContainText("Present");
  await expect(student).toContainText("Late");

  // A staff group with an hour of its own is judged by it.
  await search.fill(DEMO.staffMember);
  const staff = rowFor(page, DEMO.staffMember);
  await expect(staff).toContainText("Present");
  await expect(staff).toContainText("Late");

  // A staff group with no hour is never late, whatever the time.
  await search.fill(DEMO.staffNoHours);
  const unjudged = rowFor(page, DEMO.staffNoHours);
  await expect(unjudged).toContainText("Present");
  await expect(unjudged).not.toContainText("Late");

  // Leaving before the group's cut-off says so; the same departure from a
  // form, which has no cut-off, says only that they left.
  expect((await post(DEMO.staffMember, "13:40:00", true)).status()).toBe(200);
  expect((await post(DEMO.unscannedStudent4, "13:40:00", true)).status()).toBe(
    200,
  );

  await search.fill(DEMO.staffMember);
  await expect(staff).toContainText("Departed");
  await expect(staff).toContainText("Left early");

  await search.fill(DEMO.unscannedStudent4);
  await expect(student).toContainText("Departed");
  await expect(student).not.toContainText("Left early");

  // And in their panel, beside the day's status. (The search still holds
  // the student's number, so the staff row is brought back first.)
  await search.fill(DEMO.staffMember);
  await staff.click();
  const panel = page.getByRole("dialog");
  await expect(panel.getByText("Left early").first()).toBeVisible();
});
