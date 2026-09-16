# Deploying the harness on Vercel

An interim home for Phase 0 while the school arranges a domain and server.
The long-running Docker deployment in `docs/PHASE-0.md` remains the target
for production; this exists so the discovery day is not blocked on
infrastructure.

## What changes on a serverless host

| Concern        | Docker deployment                       | Vercel                                                                                                                                                                                     |
| -------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Process        | Long-running, migrations on boot        | Function per request; migrations run in the **build** step                                                                                                                                 |
| Spool fallback | Persistent volume, drained every minute | `/tmp` of the instance, drained at the start of the next invocation on that instance. If the database is unreachable **and** the instance is recycled first, that delivery is lost.        |
| Latency        | Sub-ms after boot                       | Cold start on the first request after idle (typically a few hundred ms). The ingest log line records `elapsedMs`; Vercel's function logs record duration. Watch both on the discovery day. |
| Source IP      | Caddy sets `X-Forwarded-For`            | Vercel sets it; `TRUST_PROXY=true` reads it. The report's IP section shows the real ADMS source.                                                                                           |
| Database       | Compose Postgres 16                     | A managed Postgres from the Vercel Marketplace (Neon or Supabase)                                                                                                                          |
| Plan           | —                                       | **Hobby is for personal, non-commercial use.** This is client work: use a Pro team, or accept that risk knowingly for a one-day run.                                                       |

Entry points: `apps/api/api/index.ts` (the function) → `src/serverless.ts`
(builds the Fastify app once per instance). `vercel.json` rewrites every path
to the function so the Fastify router sees the original URL.

## Steps

### 1. Repository

Push the repo to GitHub (or GitLab/Bitbucket). Vercel deploys from Git;
the CLI (`vercel`) also works from a local checkout if you prefer.

### 2. Project

Vercel dashboard → **Add New → Project** → import the repo.

- **Root Directory:** `apps/api`
- **Framework Preset:** Other
- Leave build/output/install blank — `vercel.json` sets the build command
  and output directory. Vercel detects the pnpm workspace from the root
  lockfile and installs from the repository root. If the build log shows it
  installing only inside `apps/api`, set **Install Command** to
  `pnpm install --frozen-lockfile --dir ../..`.

Do not deploy yet: the build runs migrations and needs the database first.

### 3. Database

Project → **Storage** → **Create Database** → Neon or Supabase (both have a
free tier). The integration adds connection strings to the project's
environment variables. Then check:

- There must be a variable named exactly **`DATABASE_URL`**. Neon's
  integration provides it; Supabase's names them `POSTGRES_URL…` — add
  `DATABASE_URL` manually with the same value.
- If the URL is the **pooled** endpoint (Neon `-pooler`, Supabase port
  6543), set `DB_STATEMENT_TIMEOUT_MS=0`. Transaction-mode poolers reject
  the startup parameter. The connect timeout still protects the endpoint.
- Neon's free tier suspends idle compute after five minutes; the first
  scan after a quiet spell pays a wake-up of a second or two. The function
  waits for it (5 s connect timeout) and spools to `/tmp` if it takes
  longer, so nothing is dropped — but the latency shows in the logs.
  Supabase's free tier does not suspend.

### 4. Environment variables

Project → **Settings → Environment Variables**, all environments:

| Name                      | Value                                                                                                |
| ------------------------- | ---------------------------------------------------------------------------------------------------- |
| `INGEST_PATH_TOKEN`       | random, 24+ chars — `node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"` |
| `REPORT_TOKEN`            | random, 32+ chars, same command with `32`                                                            |
| `TRUST_PROXY`             | `true`                                                                                               |
| `LOG_LEVEL`               | `info`                                                                                               |
| `DB_STATEMENT_TIMEOUT_MS` | `0` if pooled URL, otherwise omit                                                                    |

**Do not set `NODE_ENV`.** Vercel sets it for the runtime, and setting it
to `production` yourself makes pnpm skip devDependencies at build time,
which removes the TypeScript compiler the build needs.

### 5. Deploy and smoke test

Trigger a deployment (push, or **Deployments → Redeploy**). The build log
should end with `migrations applied`. Then, with `HOST=<project>.vercel.app`:

```bash
curl -s https://$HOST/healthz
# {"ok":true}

curl -i -X POST "https://$HOST/ingest/$INGEST_PATH_TOKEN/raw" \
  -H 'content-type: application/json' \
  -d '[{"EmpId":"20","AttTime":"2024-01-08 16:58:03","CheckingStatus":"0","VerifyType":"1","DeviceID":"CLXK221260271"}]'
# HTTP/2 200, empty body

curl -s "https://$HOST/ingest/report?token=$REPORT_TOKEN" | grep -c CLXK221260271
# 1 or more
```

`/ingest/raw` without the token and `/ingest/report` without the token must
both return 404.

### 6. Point ADMS at it

ADMS → **System → Webhook → Webhook URL** →
`https://<project>.vercel.app/ingest/<INGEST_PATH_TOKEN>/raw` → **Save
Configuration**. The field was empty on 16 September; nothing is cut over.

Within a few minutes of the next scan,
`https://<project>.vercel.app/ingest/report?token=…` should show a delivery
from an IP that is not yours.

### 7. Reading the results

Same as `docs/PHASE-0.md` → _Reading the report_. Keep a copy of
`/ingest/report.json` at the end of the day; it is the record the Phase 1
decisions are made against.

## Moving off Vercel later

The database is the only state. When the school's server is ready:
`pg_dump` the Vercel-attached database, restore into the compose Postgres,
deploy with `docker compose --profile prod up -d --build`, change the
webhook URL. `raw_events` ids carry over, so nothing needs re-analysing.
