# Phase 7 — hardening, load and recovery, docs, deploy

Gate (specification §13): _all tests green; restore rehearsed._

**Half met, and the half that is not is stated plainly below.** All 454
tests are green and the load and recovery suites pass. The restore has
**not** been rehearsed, because there is no PostgreSQL available on this
machine — the scripts and the procedure exist and self-verify, but running
them is the first thing to do on the real server.

## What was built

**Ingest defences** (§9). An address allowlist taking IPs and CIDR blocks,
a per-address rate limit, both checked in an `onRequest` hook before the
body is read, and a `404` rather than a `403` for either — the endpoint's
existence is not worth confirming to somebody who should not be there.
Every refusal is logged with its address and reason.

**Log hygiene, audited.** No names, enrolment numbers or addresses appear
in the application log, with one deliberate exception: a refused ingest
request logs its source address, because there the address _is_ the event.
Everything about people goes to the audit log instead, which cannot be
edited or deleted by anyone. Verified by grepping every log call.

**Backup and restore.** `scripts/backup.sh` dumps, encrypts (age or gpg)
and prunes to 30 days; it refuses to leave a plain dump on disk.
`scripts/restore.sh` restores into a **scratch database** by default,
prints the row counts it recovered and drops the scratch again, so the
rehearsal is safe to run on a live system — which is the only way anybody
will actually do it monthly.

**CI.** Typecheck, test, build, load, and a dependency audit that fails the
build on a high-severity advisory.

**An operations runbook** (`docs/OPERATIONS.md`) written for somebody who
did not build this: deploying, the first-week checklist, backups, and a
"when something looks wrong" section that starts from the symptom rather
than the component.

## Measured, not asserted

Ingest latency over 500 deliveries of 10 events each:

```
median 29.1ms · p99 47.9ms
```

That meets the specification's 50ms p99 target — and it was measured
against PGlite, Postgres compiled to WebAssembly and running inside the
test process, which is _slower_ than a server talking to a real Postgres
over a socket. Treat it as a floor.

5,000 events across 250 deliveries process into scans with the scan count
exactly equal to the distinct dedupe-key count, so deduplication held under
load rather than merely not crashing.

## A test that had to be moved rather than loosened

The latency assertion failed when the whole suite ran, and passed when run
alone: it was competing with other test files for the CPU. A timing
assertion under contention measures the machine, not the code, and a test
that fails for that reason teaches people to ignore failures. The load
tests now live in `*.load.test.ts`, are excluded from `pnpm test`, and run
on their own with `pnpm test:load` — in CI as a separate step.

## A vulnerability fixed rather than noted

`pnpm audit` reported a moderate advisory in `esbuild`, pulled in through a
deprecated `@esbuild-kit` package under drizzle-kit. Dev-only, and below
the threshold CI fails on — which is exactly how an advisory ends up
sitting in a tree for a year. A pnpm override lifts it to a patched
version; drizzle-kit still generates migrations, and the audit is clean.

## Choices made where the specification left them open

- **An empty allowlist allows everything**, with a warning at boot. The
  addresses are a Phase 0 finding nobody has yet; refusing everything would
  mean collecting nothing, which is worse than the risk the secret path
  already mitigates.
- **A malformed allowlist entry is reported loudly**, because an allowlist
  that silently matches nothing would lock the school's own reader out.
- **IPv4 addresses arriving in IPv6-mapped form (`::ffff:1.2.3.4`) match
  IPv4 rules.** Node presents a v4 client on a dual-stack socket that way,
  and without this the school's own reader would be refused.
- **The rate limit defaults to 1000/minute per address** — far above
  anything a school's readers produce. The platform never retries, so a
  refused scan is lost forever; a tight limit here would be a way to lose
  data, not a way to be safe.
- **The rate limiter is in memory and therefore per process.** It is the
  third line of defence, behind the secret path and the allowlist; its job
  is to stop one misbehaving client exhausting the database.

## Uncertain, or deferred

- **The restore has not been rehearsed.** No PostgreSQL on this machine.
  `scripts/restore.sh` is written and syntax-checked but has never run.
  **This is the outstanding item on the phase gate**, and it is the first
  thing to do once the school's server exists.
- **No Playwright end-to-end tests.** The specification asks for them. The
  flows they would cover (both roles' navigation, a scan appearing live,
  filters surviving a reload, a manual adjustment writing an audit entry)
  have each been driven by hand in a browser and are covered at the API
  level, but that is not the same thing and I am not going to claim it is.
- **The load figures are from PGlite, not production.** A real measurement
  against the deployed system is worth taking on the first quiet evening.
- **Nothing here has met a real scan.** Still true, and still the largest
  open risk in the project.

## What remains before the school can rely on this

1. **Run the discovery day.** The timezone is a guess, `CheckingStatus` is
   unproven, and the batch shape is unknown. Everything is configurable so
   that adapting is a settings change and a replay — but it has to actually
   happen.
2. **Import the real spreadsheet.** Encodings and unexpected group names
   surface then, not before.
3. **Rehearse the restore.**
4. **Fill in the IP allowlist** from the report.
5. **Take the Vercel deployment out of the loop.** SSE against a 15-second
   function limit reconnects constantly; the school's own server fixes it.
