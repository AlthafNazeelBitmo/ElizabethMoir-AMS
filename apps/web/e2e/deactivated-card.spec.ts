import { expect, test } from "@playwright/test";
import { DEMO, rowFor, schoolNow, signIn } from "./helpers.js";

/**
 * A deactivated person's card still opens the reader. Their scan must not
 * vanish into a record the register no longer shows: the number comes back
 * to Unknown IDs saying whose it was, and one click brings them back with
 * the scans they made in the meantime.
 */

test("a deactivated person's scan returns to Unknown IDs and reactivation claims it", async ({
  page,
}) => {
  const { date, time } = schoolNow();
  test.skip(
    Number(time.slice(0, 2)) < 3,
    `It is ${time} at the school: a scan now belongs to yesterday's day.`,
  );

  await signIn(page, "full");
  await page.goto("/admin/people");

  const enrollNo = `78${String(Date.now()).slice(-5)}`;
  const name = `Left Then Back ${enrollNo}`;

  await page.getByRole("button", { name: "Add person" }).click();
  const dialog = page.getByRole("dialog", { name: "Add a person" });
  await dialog.getByLabel("Enrolment number").fill(enrollNo);
  await dialog.getByLabel("Full name").fill(name);
  await dialog.getByLabel("Group").selectOption({ label: "Form 1" });
  await dialog.getByRole("button", { name: "Add person" }).click();
  await expect(dialog).toBeHidden();

  await page.getByLabel("Search people").fill(enrollNo);
  await rowFor(page, enrollNo)
    .getByRole("button", { name: `Actions for ${name}` })
    .click();
  await page.getByRole("menuitem", { name: "Deactivate" }).click();
  await expect(rowFor(page, enrollNo)).toHaveCount(0);

  // The card is used after they were removed.
  const response = await page.request.post(DEMO.ingestPath, {
    data: [
      {
        EmpId: enrollNo,
        AttTime: `${date} ${time}`,
        CheckingStatus: "0",
        VerifyType: "1",
        DeviceID: DEMO.device,
      },
    ],
  });
  expect(response.status()).toBe(200);
  // Processing follows the delivery; wait for it rather than racing it.
  await expect
    .poll(async () => {
      const body = (await (
        await page.request.get("/api/admin/unknown-enrollments")
      ).json()) as { unknownEnrollments: Array<{ enrollNo: string }> };
      return body.unknownEnrollments.some((u) => u.enrollNo === enrollNo);
    })
    .toBe(true);

  // Back on the list, named, with the way back rather than a form for a twin.
  await page.goto("/admin/unknown");
  const unknown = rowFor(page, enrollNo);
  await expect(unknown).toContainText(`Was ${name}, deactivated`);
  await expect(
    unknown.getByRole("button", { name: "Give this a name" }),
  ).toHaveCount(0);
  await unknown.getByRole("button", { name: `Reactivate ${name}` }).click();
  await expect(page.getByText(`${name} is back on the register`)).toBeVisible();
  await expect(rowFor(page, enrollNo)).toHaveCount(0);

  // With the scan they made while deactivated.
  await page.goto(`/register?q=${enrollNo}`);
  const row = rowFor(page, enrollNo);
  await expect(row).toContainText(name);
  await expect(row).toContainText("Present");
});
