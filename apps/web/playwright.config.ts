import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests drive the real front end against the real API.
 *
 * The API is the demo server: the whole application on an in-process
 * Postgres, seeded with a directory, a calendar and a morning's arrivals.
 * Nothing is mocked, so a test that passes here has exercised the same code
 * a browser at the school would — cookies, CSRF, the event stream, all of it.
 *
 * The data lives in one process shared by every test, which is why they run
 * one at a time and why each test picks people the others do not touch.
 */

const API_PORT = Number(process.env["E2E_API_PORT"] ?? 3100);
const WEB_PORT = Number(process.env["E2E_WEB_PORT"] ?? 5200);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  // A failure is a failure. Retrying teaches people to ignore red.
  retries: 0,
  forbidOnly: !!process.env["CI"],
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: process.env["CI"] ? [["github"], ["list"]] : "list",

  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // The register is designed for a monitor left open all day; the
    // narrow-screen card view is a different component.
    viewport: { width: 1280, height: 800 },
    timezoneId: "Asia/Colombo",
    locale: "en-GB",
  },

  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],

  webServer: [
    {
      command: "pnpm --filter @ams/api demo",
      cwd: ROOT,
      url: `http://127.0.0.1:${API_PORT}/healthz`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        PORT: String(API_PORT),
        LOG_LEVEL: "warn",
        SPOOL_DIR: path.join(ROOT, "apps/api/data/e2e-spool"),
      },
    },
    {
      // Bound to 127.0.0.1 explicitly: Vite otherwise listens on ::1 alone on
      // some Windows setups, and the readiness probe below never connects.
      command: `pnpm exec vite --host 127.0.0.1 --port ${WEB_PORT} --strictPort`,
      cwd: HERE,
      url: `http://127.0.0.1:${WEB_PORT}`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { API_PORT: String(API_PORT), WEB_PORT: String(WEB_PORT) },
    },
  ],
});
