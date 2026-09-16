# Phase 1 — schema, auth, RBAC, sessions

Gate (specification §13): _both roles log in; role isolation tests pass._

## What was built

**The full data model.** Every table in specification §5 now exists, in
`apps/api/src/db/schema/` split by concern (identity, directory, events,
ops), with migrations `0001` and `0002` committed. `raw_events` from Phase 0
is unchanged.

**Authentication.** Argon2id at 19 MiB / 2 passes / 1 lane. Server-side
sessions in Postgres, `httpOnly` `SameSite=Lax` cookies, 8 hours idle and 12
hours absolute. CSRF tokens bound to the session. Account lockout at 5
failures in 15 minutes, per account and per IP independently. Password
policy: 12 characters minimum, blocklist, no composition rules. Endpoints:
`POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`,
`POST /api/auth/change-password`.

**Role isolation.** `src/auth/scope.ts` provides the branch predicate that
every people-touching query must compose in. `requireRole` gates whole
endpoints; the predicate is what actually keeps staff rows away from a
`student_only` account.

**Audit log.** Append-only, enforced by a database trigger rather than by
application discipline: `UPDATE` and `DELETE` on `audit_log` raise an
exception, and there is a test that proves it.

**Reference data.** Migration `0002` seeds the eleven groups and the four
attendance-rule settings, idempotently.

**First account.** `pnpm --filter @ams/api create-user <email> <role> "<name>"`
generates a password, prints it once, and forces a change at first login.
There is no seeded default account.

## Tests

160 passing, 11 files. Notably:

- 37 auth tests through the real HTTP stack: both roles logging in, identical
  answers for wrong-password and unknown-address, lockout and its expiry,
  CSRF rejection including another session's token, both session expiry
  rules, and that no password reaches the audit log.
- 12 role-isolation tests against real rows: zero staff rows for a
  `student_only` query, and it stays zero when the staff member is asked for
  by id, by group, or through a count.
- 13 schema tests of database-enforced constraints, including the
  append-only trigger.
- The Phase 0 ingest tests, which previously could not run at all.

**The test database changed.** Tests now run against PGlite — real Postgres
18 compiled to WebAssembly, in-process, a fresh database per suite. The
committed migrations are applied exactly as in production, so the suite also
checks the migration SQL. This replaced a Docker Compose Postgres that was
never reachable on the development machine, which meant the Phase 0
integration tests had never been executed once. `pnpm test` now runs
everything with no external service, and `test:integration` is gone because
there is nothing left for it to separate.

## Choices made where the specification left them open

- **`email text` rather than `citext`.** citext is a contrib extension, not
  available in every environment the suite runs in. The column is `text`
  with a `CHECK (email = lower(email))` and normalisation at every boundary.
  That is stronger than citext in one respect: the stored form is guaranteed
  canonical, so a duplicate cannot enter through SQL that bypasses the
  application.
- **`sessions.csrf_hash`**, a column the specification's table list does not
  have. Required to bind the mandated CSRF token to the session rather than
  trusting a cookie pair alone.
- **Lockout counts come from `audit_log`**, which is already required to
  record every login failure with its IP, rather than from a new table. The
  `failed_attempts` column is still maintained for display.
- **The attempt that trips the lock says so** (429), rather than reporting a
  bad password and leaving the user to meet a different message next time.
- **A `student_only` user cannot see people with no group at all.** An
  unclassified person might be staff, and the wrong guess leaks. They are
  visible in admin, where they can be given a group.
- **Session tokens are hashed with SHA-256, not Argon2.** They are 256 bits
  of randomness, so there is nothing for a slow hash to defend; a slow hash
  on every authenticated request would be a self-inflicted denial of service.
- **No `Max-Age` on the session cookie.** Lifetime is enforced server-side
  against the sessions row, which is the only place it can be enforced.

## Uncertain, or deferred

- **The role-isolation tests exercise the mechanism, not endpoints**, because
  no endpoint serves people yet. The specification asks for a test per
  endpoint; those arrive with the endpoints in Phases 3 and 4, and must use
  `branchFilter`. Reviewing that they do is the thing to watch for.
- **The common-password list is pragmatic, not exhaustive** — roughly 160
  entries covering the classic lists, keyboard walks, and words specific to
  this deployment. The honest upgrade is the Have I Been Pwned range API,
  which needs a timeout and a fail-open decision on the login path.
- **`settings.timezone` is seeded as `Asia/Colombo`** from the evidence in
  the ADMS reconnaissance, not from the discovery run. It is provisional and
  editable, and must be confirmed against the Phase 0 report before any late
  or absent figure is trusted.
- **Argon2id is a native module.** It works locally and should work on
  Vercel, but the deployment has not been rebuilt since it was added — the
  first deploy after this phase is the one to watch.
- **Phase 0's gate is still open.** This phase was built because none of it
  branches on the feed's unknowns; everything that does (direction
  resolution, dedupe semantics, timezone) is Phase 2 and is deliberately
  untouched.
