# Phase 0 — discovery harness

Spec §2. Purpose: record exactly what the ADMS webhook sends, for one full
school day, before any interpretation is written. Eight facts about the feed
are unknown; guessing them causes rework.

## What was built

| Piece                      | Where                                                               | Notes                                                                                                        |
| -------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `POST /ingest/<token>/raw` | `apps/api/src/ingest/routes.ts`                                     | Any content type, any method. Always `200`, empty body. Never throws.                                        |
| `raw_events` table         | `apps/api/src/db/schema.ts`, `apps/api/drizzle/0000_raw_events.sql` | Permanent. Spec columns plus `method` and `body_bytes`.                                                      |
| Disk spool                 | `apps/api/src/ingest/spool.ts`                                      | If Postgres refuses the insert, the envelope is written to `SPOOL_DIR` and drained every minute.             |
| 1 MB cap                   | `INGEST_BODY_LIMIT_BYTES`                                           | Oversize deliveries are discarded but a row is written recording size and reason.                            |
| `GET /ingest/report`       | `apps/api/src/discovery/`                                           | HTML page answering every unknown. `Authorization: Bearer <REPORT_TOKEN>` or `?token=`. Wrong token → `404`. |
| `GET /ingest/report.json`  | same                                                                | Same analysis as JSON, for keeping a copy.                                                                   |

The analysis (`analyze.ts`) is pure and unit-tested against the vendor's own
sample payload; the HTML renderer escapes every value from the feed.

## Choices made where the spec left them open

- **Secret path segment even in Phase 0.** The spec names the route
  `/ingest/raw`; it is exposed as `/ingest/<INGEST_PATH_TOKEN>/raw` when the
  token is set (recommended) so stray bots cannot pollute the sample. The bare
  path then returns `404`. Leave the token unset to get the spec's literal path.
- **The insert is awaited, with bounded timeouts.** Connect and statement are
  capped at 5 s (`db/client.ts`), so a hung database fails over to the spool
  rather than holding the webhook open. On a healthy local Postgres the insert
  is low single-digit milliseconds.
- **No rate limit in Phase 0.** A `429` would lose a delivery, and the whole
  point of this phase is to see the feed's real burst shape. The report shows
  per-IP counts and inter-arrival gaps; the Phase 2 limit is sized from those.
- **All request headers are stored verbatim,** including anything that looks
  like a credential, because unknown #6 asks exactly that question. If the
  report shows a real secret in a header, it is redacted in Phase 2 before the
  table becomes long-lived operational data.
- **Every HTTP method is accepted on the ingest path** and recorded. The
  vendor's PHP checks for `POST`; if the platform sends something else we want
  evidence, not a `404`.
- **Migrations run on API boot.** One container, one command, no manual step.
- **Local Postgres on 5433.** Development machines commonly have a native
  Postgres on 5432; the compose service avoids the clash.

## Deploying the harness

You need: a VPS (or school server) reachable from the internet, a DNS name
pointing at it, Docker with Compose, and the ADMS admin login to change the
webhook URL.

```bash
# on the server
git clone <repo> ams && cd ams
cp .env.example .env
```

Edit `.env`:

```
PUBLIC_HOST=ams.<school-domain>          # DNS A record must already resolve
POSTGRES_PASSWORD=<random>
INGEST_PATH_TOKEN=<random, 24+ chars>    # node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
REPORT_TOKEN=<random, 32+ chars>
NODE_ENV=production
```

Then:

```bash
docker compose --profile prod up -d --build
docker compose logs -f api            # wait for "migrations applied" and the listen line
curl -s https://$PUBLIC_HOST/healthz  # {"ok":true}
```

Smoke test with the vendor's sample:

```bash
curl -i -X POST "https://$PUBLIC_HOST/ingest/$INGEST_PATH_TOKEN/raw" \
  -H 'content-type: application/json' \
  -d '[{"EmpId":"20","AttTime":"2024-01-08 16:58:03","CheckingStatus":"0","VerifyType":"1","DeviceID":"CLXK221260271"}]'
# expect: HTTP/2 200, empty body

curl -s -H "Authorization: Bearer $REPORT_TOKEN" "https://$PUBLIC_HOST/ingest/report" | head
```

Then delete the smoke-test row so it does not pollute the sample — or simply
note its timestamp; it will be obvious in the report as the one delivery from
your own IP.

### Point ADMS at it

ADMS → **System** → **Webhooks** → _Webhook URL_ →
`https://<PUBLIC_HOST>/ingest/<INGEST_PATH_TOKEN>/raw` → **Save**.

As of 16 September the field is empty,
so setting it cuts nothing over. The ADMS _Data → Transactions_ screen keeps
working regardless and remains the school's fallback for the day.

### If no public server is available yet

For the discovery day only, a tunnel (Cloudflare Tunnel, ngrok) in front of a
local `pnpm dev` works. It gives a public HTTPS URL without a VPS. The
report's source-IP section will then show the tunnel's exit IPs, **not** the
platform's — note that when reading unknown #7, and re-check it on the real
deployment before enabling the allowlist.

## Reading the report

Open `https://<PUBLIC_HOST>/ingest/report?token=<REPORT_TOKEN>` after the
school day (roughly 16:00 local). Each section maps to a spec unknown:

| Section                     | Unknown | What to look for                                                                                                                                                                                                                         |
| --------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 Field names               | #1      | Which spelling(s) of the verify-type key appear, and on what fraction of events.                                                                                                                                                         |
| 2 AttTime timezone          | #2      | The verdict line. Median offset ≈ +330 min ⇒ local Colombo time. The hour-of-day histogram should peak in the morning on the same clock.                                                                                                 |
| 3 CheckingStatus per device | #3      | Per device: one value only ⇒ flag is useless there. Alternating ⇒ meaningful. Same-second pairs ⇒ vendor artefact. Also _scans per person per day_: mostly 2 ⇒ one reader handles both directions; mostly 1 ⇒ paired entry/exit readers. |
| 4 Batch size / arrival      | #4      | Median and max batch; gap distribution. Sizes the queue and the SSE fan-out.                                                                                                                                                             |
| 5 Redelivery                | #5      | Exact repeats across deliveries ⇒ platform redelivers. Repeats differing only in status ⇒ artefact.                                                                                                                                      |
| 6 Headers                   | #6      | Any row marked _possible credential_.                                                                                                                                                                                                    |
| 7 Source                    | #7, #8  | The IPs for the allowlist. The Content-Type the platform actually sends.                                                                                                                                                                 |
| 8 Devices / overlap         | (new)   | Whether an EmpId appears on more than one device. See below.                                                                                                                                                                             |

Save a copy: `curl -H "Authorization: Bearer $REPORT_TOKEN" .../ingest/report.json > phase0-findings.json`.

## A ninth unknown, from the vendor documentation

The ADMS _Personnel → Employees_ screen lists employees **per device**, and
enrollment on one reader is copied to others only when someone presses
_Transfer Template_. So `EmpId` is guaranteed unique per device, not
necessarily across the school. If the school has more than one reader and
templates are not synced, EmpId 12 at the front gate and EmpId 12 at the
staff entrance may be two people.

The report's section 8 shows whether any EmpId was seen on multiple devices.
Combined with an answer from the school ("are all readers enrolled from one
master and synced?"), this decides whether `people.enroll_no` alone is the
key (spec's assumption) or whether it must be `(device, enroll_no)` with a
mapping table. This must be settled before Phase 1's schema is final.

## What to send back after the day

Findings for each unknown, in plain language, plus the answers to:

1. How many readers does the school have, where are they, and which direction
   does each face?
2. Are the readers enrolled once and synced (Transfer Template), or enrolled
   independently?
3. Does the platform's webhook accept an `https://` URL? (It did if the report
   has data.)
4. Roughly how many students and staff — the register is sized for 1,200.
