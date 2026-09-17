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
| Scheduled work | A five-minute interval in-process       | Every invocation sweeps (spool, pending scans, absences) at most once a minute per instance, kept alive past the response with `waitUntil`; a daily cron at 04:00 UTC (09:30 Colombo) is the floor. Hobby refuses anything more frequent than daily. |
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

- **Any** of these names works; `DATABASE_URL` wins if several are set:
  `DATABASE_URL`, `POSTGRES_URL`, `POSTGRES_PRISMA_URL`,
  `DATABASE_POSTGRES_URL`. So Neon's and Supabase's integrations are both
  fine out of the box, with nothing to rename.
- Migrations prefer a **direct** (unpooled) endpoint if one is published —
  `DATABASE_URL_UNPOOLED`, `POSTGRES_URL_NON_POOLING`, `DIRECT_DATABASE_URL`
  or `DIRECT_URL` — because DDL through a transaction-mode pooler is
  unreliable. The runtime keeps using the pooled URL. Both integrations
  publish the pair automatically; nothing to configure.
- If the runtime URL is the **pooled** endpoint (Neon `-pooler`, Supabase
  port 6543), set `DB_STATEMENT_TIMEOUT_MS=0`. Transaction-mode poolers
  reject that startup parameter. The connect timeout still protects the
  endpoint.
- Environment variables are read **at build time**. After attaching a
  database or adding a variable you must trigger a **new deployment** —
  redeploying an existing build does not pick them up. If you use
  **Deployments → Redeploy**, clear the _Use existing build cache_ option.
- Neon's free tier suspends idle compute after five minutes; the first
  scan after a quiet spell pays a wake-up of a second or two. The function
  waits for it (5 s connect timeout) and spools to `/tmp` if it takes
  longer, so nothing is dropped — but the latency shows in the logs.
  Supabase's free tier does not suspend.

### 3b. The web app is served from the same deployment

`vercel.json` points Vercel at `apps/api/.static`, which the build fills with
the compiled web app plus `public/` (`pnpm run build:vercel`). The function
answers `/api/*`, `/ingest/*`, `/internal/*` and `/healthz`; every other
path falls back to `index.html`, so the register, reports and admin all
load at the deployment's own address. One origin, deliberately: the
session cookie is same-origin and would not survive a split.

### 4. Environment variables

Two ways. Scripted, from a checkout:

```bash
npx vercel login                      # once, interactive
bash scripts/setup-vercel-env.sh      # sets the variables, then deploys
```

On Windows, run that from **Git Bash**, not PowerShell — PowerShell has no
`bash`. (Git for Windows installs it; it is the shell VS Code and Claude
Code use.) The variables are not optional: without `INGEST_PATH_TOKEN` and
`REPORT_TOKEN` the function refuses to start and every route answers 503
"Service is misconfigured", with the missing name in the function log.

It reads the values from `.env.vercel.local` (gitignored), sets each variable
for production, preview and development, and triggers a production
deployment. Re-running is safe.

Or by hand — Project → **Settings → Environment Variables**, all environments:

| Name                      | Value                                                                                                |
| ------------------------- | ---------------------------------------------------------------------------------------------------- |
| `INGEST_PATH_TOKEN`       | random, 24+ chars — `node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"` |
| `REPORT_TOKEN`            | random, 32+ chars, same command with `32`                                                            |
| `TRUST_PROXY`             | `true`                                                                                               |
| `LOG_LEVEL`               | `info`                                                                                               |
| `DB_STATEMENT_TIMEOUT_MS` | `0` if pooled URL, otherwise omit                                                                    |

`INGEST_PATH_TOKEN` and `REPORT_TOKEN` are **required** — the function
refuses to start without them and every request returns 503 with the reason
in the function log. The ingest token is mandatory in production
specifically: without it the endpoint would be the bare `/ingest/raw`, which
anyone who found the URL could post fabricated attendance to.

**Do not set `NODE_ENV`.** Vercel sets it for the runtime, and setting it
to `production` yourself makes pnpm skip devDependencies at build time,
which removes the TypeScript compiler the build needs.

### 4b. The first account

Nothing ships with a default login. Create the first administrator from a
checkout, against the production database, with the environment pulled
from Vercel — this works in PowerShell as well as Git Bash:

```powershell
npx vercel env pull .env.production.local --environment=production
pnpm --filter @ams/api build
node --env-file=.env.production.local apps/api/dist/cli/create-user.js head@school.lk full "A Head Teacher"
```

The command prints a temporary password once; the account must change it
at first sign-in. `.env.production.local` is gitignored — delete it when
done. Further accounts are created in Admin → Users.

### 5. Deploy and smoke test

Trigger a deployment (push, or **Deployments → Redeploy** with the build
cache disabled). The build log should show `applying migrations using
<VARIABLE>` followed by `migrations applied`. If it instead says no
connection string was found, the database is not attached to this project
or the variable is not enabled for the environment being built.

Then run the smoke test, which checks reachability, that the endpoint is not
discoverable without the token, that ingest answers 200 to malformed and
odd-shaped requests, and that the report reflects what was posted:

```bash
bash scripts/smoke-test.sh
```

Or by hand, with `HOST=<project>.vercel.app`:

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
