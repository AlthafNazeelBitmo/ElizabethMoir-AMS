# Phase 4 — live register, SSE, filtering, person panel

Gate (specification §13): _a scan appears live, correctly grouped._

**Met, and verified in a browser.** A scan posted to the ingest endpoint
moved a student from "Not expected" to "On site 09:15 · Late" without a
refresh: the row updated in place without re-sorting, the counters went
55→56 on site and 24→25 late, and that student's form went 18/30 → 19/30 in
the left rail.

## What was built

**The register API.** `GET /api/register/live` (cursor-paginated),
`/summary` (counters plus a live count per group), `/stream` (SSE),
`/api/people/:id` and `/:id/scans`, and `PATCH /api/day-records/:id` for
manual correction.

**The event stream.** Monotonic ids, `Last-Event-ID` replay from a bounded
buffer, a heartbeat every 20 seconds, and an honest `resync` event when the
gap is larger than the buffer can fill — the client refetches rather than
rendering a screen with holes in it. Events are filtered by role _before a
byte reaches the socket_.

**The web application.** React 19, Vite, TanStack Query and Virtual, React
Router, Tailwind. The live register with the left rail, pinned filter bar,
animated counters, virtualised table, person panel, manual correction,
login, and forced password change.

**A demo server.** `pnpm --filter @ams/api demo` runs the entire stack
against an in-process Postgres with a hundred believable people and a
morning's arrivals — no Docker, no managed database, nothing to install.
This is how Phase 4 was verified, and it is the fastest way to show the
school what they are getting.

## The register's rules, and how they are kept

- **The page never scrolls.** `body` is `overflow: hidden`; the table has
  its own scroll and the header sits outside it.
- **A scan updates its row in place.** The rows are held in component state,
  and an event patches one of them. No re-sort, no refetch. Someone reading
  row 40 stays on row 40.
- **The highlight is the only motion nobody asked for.** It fades over 1.5
  seconds. Under `prefers-reduced-motion` it becomes an instant colour
  change and the counter pulse is removed entirely.
- **Connection state is always visible**, and a dropped stream shows an
  amber bar reading "Reconnecting — showing data from 14:32". Stale data is
  never presented as live.
- **Filters live in the URL**, so a view can be bookmarked and shared, and
  a reload does not lose it. "Clear filters" appears only when something is
  set.
- **Colour is never the only carrier of status.** Each has a label and a
  distinct shape — a filled dot, a half dot, a ring, a cross, a dashed
  outline — because red/green is unreadable to someone with deuteranopia and
  this screen is read at a glance from across a room.
- **Tabular figures on every time and count**, so digits align down the
  column.

## Choices made where the specification left them open

- **Free text and status are filtered in the browser; group, tutor, branch
  and date on the server.** The rows for a date are already loaded, so
  typing stays instant and no refetch races the live stream. The server
  still enforces every one of them.
- **A person who was not already on screen is not spliced in by an event.**
  A newly attached enrolment appears on the next fetch rather than
  appearing at an arbitrary scroll position.
- **`/api/people/:id` answers 404, not 403**, for a person the role may not
  see. A 403 would confirm they exist.
- **The register fetches every page at load** (bounded at 40 pages) rather
  than paging as you scroll: the table is virtualised, and a wall display
  should not be making requests while someone reads it.
- **Times render in the school's timezone, not the browser's**, so the
  screen reads the same from anywhere.
- **Reports and most of Admin are honest placeholders.** The unknown-ID list
  is built because the office uses it weekly; the rest says what is coming
  and where the command line does it meanwhile. A half-working reports
  screen would have people quoting figures nobody has reconciled.

## Tests

367 passing overall, 42 new on the register: that a `student_only` account
gets zero staff rows through a search term, a group id, `branch=staff`, a
count or a person fetched by id; that someone with no day record still
appears; that absence is not declared before the day has started; cursor
paging; that a manual correction needs a reason, records who and why, and
survives recomputation; and that the broadcaster never delivers a staff
event to a student-only subscriber, replays what was missed, and says so
when the gap is too large.

The front end has no automated tests yet — see below.

## Uncertain, or deferred

- **No front-end tests.** The specification's end-to-end tests (Playwright)
  are Phase 7. The register was verified by hand in a browser, including
  both roles and the narrow layout, but "verified once" is not "tested".
- **SSE and serverless do not mix.** A Vercel function is capped at 15
  seconds, so the stream will drop and reconnect constantly there. The
  client survives it — reconnect plus replay — but the interim deployment
  will feel worse than the real one. Another reason the school's server
  matters.
- **The 1,200-row target has not been measured.** The demo runs 102 people.
  Virtualisation is in place; the load test is Phase 7.
- **`prefers-reduced-motion` was implemented but not verified** in a browser
  with the setting on.
- **The "updates below" pill scrolls to the most recent change**, not to the
  first one out of view. Good enough, not obviously right.
