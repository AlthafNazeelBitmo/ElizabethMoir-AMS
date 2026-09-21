import { expect, type Page } from "@playwright/test";

/**
 * What the demo server seeds, as far as the tests need to know it.
 * See `apps/api/src/cli/demo-server.ts`.
 */
export const DEMO = {
  password: "brass lantern quiet morning",
  full: { email: "head@school.example", name: "Head Teacher" },
  studentOnly: { email: "office@school.example", name: "Office" },
  ingestPath: "/ingest/demo-ingest-token-abcdefghij/raw",
  device: "DEMO000000001",
  timezone: "Asia/Colombo",
  /** Students 11000–11054 arrive in the seed; 11055–11089 have no scans. */
  seededStudent: "11001",
  /** Left untouched by the correction test, so its day reads as seeded. */
  reportStudent: "11002",
  unscannedStudent: "11060",
  /** Another with no scans, for a second test in the same file to move. */
  unscannedStudent2: "11061",
} as const;

export async function signIn(
  page: Page,
  who: "full" | "studentOnly",
): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(DEMO[who].email);
  // Exact: "Show password" is a label too, on the button beside the field.
  await page.getByLabel("Password", { exact: true }).fill(DEMO.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/register/);
  // The register is only there once the session is confirmed.
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
}

/** Today's date and the current time, both as the school's clock reads them. */
export function schoolNow(): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: DEMO.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}:${get("second")}`,
  };
}

/** The register row for one person, found by enrolment number. */
export function rowFor(page: Page, enrollNo: string) {
  return page
    .getByRole("row")
    .filter({ has: page.getByText(enrollNo, { exact: true }) });
}
