import { expect, test, type Page, type Route } from "@playwright/test";
import { signIn } from "./helpers.js";

/**
 * What the register does when its stream comes back from somewhere else.
 *
 * Replay only works within one server process. When a reconnect is greeted
 * by a different process — a restart, or a host that keeps several — the
 * events in between went to a buffer this connection never had, and the
 * only honest thing is to fetch the screen again. Same process: nothing to
 * do, replay covered it. A host that says it cannot promise continuity at
 * all: fetch on every reconnect.
 *
 * The stream is stood in for here, so the test controls who answers each
 * connection. A fulfilled response is a complete body, so the browser reads
 * the greeting, sees the connection end, and reconnects — which is exactly
 * the sequence being tested. Each connection notes how many register
 * fetches had been made by the time it was opened, so what a greeting
 * caused can be read off without guessing at reconnect timing.
 */

interface Greeting {
  instance: string;
  continuity: "buffer" | "none";
}

function countRegisterFetches(page: Page) {
  const counter = { n: 0 };
  page.on("request", (request) => {
    if (/\/api\/register\/live\b/.test(request.url())) counter.n += 1;
  });
  return counter;
}

function serveGreetings(
  page: Page,
  greetings: Greeting[],
  fetches: { n: number },
) {
  /** Register fetches made before each connection was opened. */
  const fetchesBefore: number[] = [];
  void page.route("**/api/register/stream", (route: Route) => {
    const index = fetchesBefore.length;
    fetchesBefore.push(fetches.n);
    const greeting = greetings[Math.min(index, greetings.length - 1)]!;
    const data = JSON.stringify({
      lastEventId: 0,
      role: "full",
      ...greeting,
    });
    return route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream; charset=utf-8" },
      body: `event: hello\ndata: ${data}\n\n`,
    });
  });
  return fetchesBefore;
}

test("a reconnect greeted by a different process refetches; the same one does not", async ({
  page,
}) => {
  const fetches = countRegisterFetches(page);
  const before = serveGreetings(
    page,
    [
      { instance: "process-a", continuity: "buffer" },
      { instance: "process-a", continuity: "buffer" },
      { instance: "process-b", continuity: "buffer" },
      { instance: "process-b", continuity: "buffer" },
      { instance: "process-b", continuity: "buffer" },
    ],
    fetches,
  );
  await signIn(page, "full");
  await expect
    .poll(() => before.length, { timeout: 20_000 })
    .toBeGreaterThanOrEqual(6);

  // The page fetched once to load, before the stream ever connected.
  expect(before[0]).toBeGreaterThanOrEqual(1);
  // Greeting 1 (process-a) was the first: trusted, nothing fetched.
  // Greeting 2 (process-a again): the same process; nothing fetched.
  expect(before[2]).toBe(before[0]);
  // Greeting 3 (process-b): a stranger; the screen was fetched again.
  expect(before[3]).toBeGreaterThan(before[2]!);
  // Greetings 4 and 5 (process-b again): known now; nothing more.
  expect(before[4]).toBe(before[3]);
  expect(before[5]).toBe(before[3]);
});

test("a host that promises no continuity is refetched on every reconnect", async ({
  page,
}) => {
  const fetches = countRegisterFetches(page);
  const before = serveGreetings(
    page,
    [{ instance: "process-a", continuity: "none" }],
    fetches,
  );
  await signIn(page, "full");
  await expect
    .poll(() => before.length, { timeout: 20_000 })
    .toBeGreaterThanOrEqual(4);

  // The first greeting is trusted; every one after it causes a fetch.
  expect(before[1]).toBe(before[0]);
  expect(before[2]).toBeGreaterThan(before[1]!);
  expect(before[3]).toBeGreaterThan(before[2]!);
});
