# Phase 2 — ingest, processing, dedupe, direction, day records

Gate (specification §13): _a real scan lands correctly end to end._

## The problem this phase had to solve

The build order assumes Phase 0's discovery run has already answered eight
questions about the feed before this code is written. The school cannot run
the discovery day until the system is finished, so those answers do not
exist and will not until the end.

Guessing them would bake assumptions into the processor that are expensive
to unpick. Instead every unknown is a **runtime decision**, and `raw_events`
is the correction path: the envelopes are kept verbatim and forever, scans
carry the transmitted local time as well as the converted instant, and every
step is idempotent. When the real data finally arrives, adapting is a
settings change and a replay — not a rewrite.

| Unknown                                     | How it is handled without the answer                                                                                                                                                            |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. `VerifyType` or `VeryfyType`             | Both are read, and any other casing, via a pattern. Whichever they send is captured.                                                                                                            |
| 2. What timezone `AttTime` is               | A setting. `att_time_local` keeps the transmitted string, so a corrected zone re-derives every instant from the original.                                                                       |
| 3. Whether `CheckingStatus` means direction | Only consulted for a device an administrator has marked `trust_checking_status`, and only through a configured value→direction map that starts **empty**. Until then the sequence rule decides. |
| 4. Batch size and frequency                 | Processing is batched and bounded, and driven by outstanding rows rather than by a queue sized to a guess.                                                                                      |
| 5. Whether the platform redelivers          | The dedupe key makes it irrelevant: redelivery, replay and overlapping backfills all converge.                                                                                                  |
| 6. Authentication headers                   | Recorded; nothing depends on them.                                                                                                                                                              |
| 7. Source IPs                               | Recorded; the allowlist stays off until they are known.                                                                                                                                         |
| 8. Content type                             | Already irrelevant — ingest accepts anything.                                                                                                                                                   |

## What was built

**Pure domain layer**, no I/O and no clock, in `src/domain/`:

- `time.ts` — naive local ↔ instant through the IANA database, school-day
  assignment with the configurable rollover, threshold instants.
- `dedupe.ts` — the specification's key, over the transmitted local string
  so a timezone correction cannot change a scan's identity.
- `direction.ts` — the four rules in order, plus duplicate collapsing.
- `dayRecord.ts` — every status, `is_late` as a separate flag.

**The processor** (`src/processing/`) reads outstanding envelopes, extracts
scans defensively, converts times, registers devices, resolves people,
inserts scans on the dedupe key, then re-resolves each affected person-day
and rewrites its record.

**Settings service** with code defaults, so a fresh database works and a
nonsense value falls back per field rather than crashing the processor.

## Choices made where the specification left them open

- **`raw_events` is the queue; there is no Redis.** The specification names
  Redis and BullMQ, _and_ requires a reconciler that processes unprocessed
  rows when Redis is down — which means the reconciler must be able to do
  the whole job anyway. Making it the only path removes a service that can
  fail, works unchanged on a serverless host where no worker process can
  exist, and avoids two code paths that can drift. A queue can be added
  later for latency without changing the processor. **This is a deliberate
  deviation and the one most worth arguing about.**
- **Processing starts the moment a delivery is stored**, chained rather than
  parallel, and the response never waits for it. A scheduled drain (an
  interval on a long-running host, Vercel Cron on serverless) catches
  anything missed.
- **The day is resolved as a whole, not scan by scan.** Direction under the
  sequence rule depends on what came before, so an event that arrives out of
  order re-runs the day and corrects everything after it. There is a test
  for exactly that.
- **An undecidable scan does not advance the alternation.** Guessing past it
  would corrupt every direction after it too.
- **A repeat tap inherits the direction of the tap it repeats**, so it can
  never flip the alternation. Both raw rows are kept, as the specification
  requires; only the derived record collapses them.
- **A date the calendar does not know is not a school day.** An empty
  calendar therefore produces no absences at all. A missing absence is a
  gap; an invented one is an accusation about a child.
- **Someone whose scans all have unknown direction is `on_site`, not
  `absent`.** They were at the gate. Reporting a child missing when the
  evidence says otherwise is the dangerous direction to be wrong in; the
  unknown-direction count surfaces the data-quality problem instead.
- **A person with no group is `not_expected`** until somebody classifies
  them, rather than being counted absent.
- **`has_manual_edit` days are never overwritten** by a recomputation.
- **New settings** the specification does not list: `checking_status_map`
  (needed for direction rule 2 and empty until proven) and
  `absence_decided_after` (defaulting to 09:00, an hour after the late
  threshold, so latecomers are not reported missing while in transit).

## Tests

255 passing overall, 99 new in this phase:

- 22 timezone tests including a spring-forward gap and an autumn overlap in
  a DST zone, to prove nothing assumes a fixed offset.
- 25 direction and dedupe tests covering all four rules, their precedence,
  duplicate collapsing, out-of-order delivery, and the vendor's own
  same-second pair.
- 24 day-record tests covering every status and the edge cases the
  specification names: a single scan, an odd count, a mid-day departure and
  return, no group, no threshold.
- 23 processor tests end to end from a webhook POST: correct instant,
  either verify-type spelling, idempotent replay and redelivery, unknown
  enrolments preserved, out-of-order correction, manual edits respected.

## Uncertain, or deferred

- **Nothing here has met a real scan.** Every test uses the vendor's
  documented shape or plausible variations. The discovery run remains the
  thing that turns this from careful to verified, and the report is still
  the first thing to read when the feed goes live.
- **The timezone default is provisional.** `Asia/Colombo` comes from the
  ADMS reconnaissance, not from the feed. Until the report confirms it, no
  late or absent figure should be quoted to the school.
- **Vercel's Hobby plan runs cron once a day**, not every five minutes as
  configured. The inline trigger after ingest covers the normal case, so
  this only matters for recovering missed work — but it is another reason
  the interim deployment is interim.
- **Load has not been tested.** The specification's 5,000 events in 60
  seconds belongs to Phase 7 and needs a real deployment.
- **The dead-letter queue and replay UI** are Phase 6. Today a failed
  envelope is marked with its reason and left in `raw_events`, which is
  where the replay will read from.
