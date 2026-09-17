# Running the system

Everything an administrator or whoever inherits this needs in order to keep
it working. Written to be read by somebody who did not build it.

## What it is, in one paragraph

ZKTeco readers send every scan to the ADMS middleware, which posts it to a
webhook URL. This system receives those posts, writes them down verbatim,
works out who scanned and whether they were arriving or leaving, and shows
the result as a live register. Two kinds of account exist: one that sees
students and staff and can administer, and one that sees students only.

## Deploying

```bash
git clone <repo> ams && cd ams
cp .env.example .env
```

Fill in `.env`:

| Variable             | What it is                                                  |
| -------------------- | ----------------------------------------------------------- |
| `PUBLIC_HOST`        | The DNS name, which must already resolve to this server     |
| `POSTGRES_PASSWORD`  | Anything long and random                                    |
| `INGEST_PATH_TOKEN`  | 24+ random characters — becomes part of the webhook URL     |
| `REPORT_TOKEN`       | 32+ random characters — opens the Phase 0 report            |
| `INGEST_ALLOWED_IPS` | The platform's addresses, once known. Empty allows all      |
| `BACKUP_PASSPHRASE`  | Long and random, **stored somewhere other than the server** |

Generate the tokens:

```bash
node -e "const c=require('crypto');for(const n of['INGEST_PATH_TOKEN','REPORT_TOKEN','BACKUP_PASSPHRASE'])console.log(n+'='+c.randomBytes(32).toString('base64url'))"
```

Then:

```bash
docker compose --profile prod up -d --build
docker compose logs -f api          # expect "migrations applied", then the listen line
curl -s https://$PUBLIC_HOST/healthz
```

Create the first account — nothing ships with a default one:

```bash
docker compose exec api node dist/cli/create-user.js head@school.lk full "A Head Teacher"
```

Finally, point ADMS at it: **System → Webhook → Webhook URL** →
`https://<PUBLIC_HOST>/ingest/<INGEST_PATH_TOKEN>/raw` → Save.

## First-week checklist

1. **Name the school.** Admin → Rules → School name. It is printed on
   every report and shown in the title bar; until it is set, they say
   "School". To show the crest, put it at `apps/web/public/branding/logo.svg`
   (or `.png`) on the server; it is picked up on the next load and is never
   part of the code.
2. **Set the calendar.** Admin → Calendar. Until a date is marked a school
   day, nobody can be absent on it — so absence reporting says nothing
   until this is done. Set the term as weekdays, then carve out holidays.
3. **Import the directory.** Admin → People, or from a checkout:
   `pnpm --filter @ams/api import-directory people.csv --confirm`. Groups
   named in the file are created as it loads; tidy them afterwards under
   Admin → Groups — the order they appear in, which ones expect attendance
   (contractors do not), and any group with its own late threshold.
4. **Name the readers.** Admin → Devices. If a reader is mounted so that
   everyone passing it is arriving, set it to _Entry only_ — that makes
   every direction from it certain instead of inferred.
5. **Confirm the timezone.** Admin → Rules. It is set to `Asia/Colombo`
   from evidence, not from the feed. Check it against the discovery report
   before quoting any late or absent figure to anybody.
6. **Fill in the allowlist.** Once the report shows which addresses the
   platform posts from, put them in `INGEST_ALLOWED_IPS` and restart.
7. **Take a backup and restore it** (below). A backup nobody has restored
   is a hope, not a backup.

## Backups

`scripts/backup.sh` dumps the database, encrypts it, and prunes anything
older than 30 days. It refuses to leave an unencrypted dump lying about —
the file contains the movement history of every child in the school.

Daily, by cron on the host:

```cron
15 2 * * *  cd /srv/ams && set -a && . ./.env && set +a && scripts/backup.sh >> /var/log/ams-backup.log 2>&1
```

Keep `BACKUP_PASSPHRASE` somewhere other than the server. A backup
encrypted with a key stored beside it protects against nothing.

### Rehearsing a restore

```bash
cd /srv/ams && set -a && . ./.env && set +a
scripts/restore.sh backups/ams-<stamp>.dump.age
```

With no `--into`, this restores into a scratch database, prints the row
counts it recovered, and drops the scratch database again. **The live
database is not touched**, so it is safe to run on a working system — and
it is the only way to know the backups are real. Do it monthly.

Restoring for real, after losing the database:

```bash
scripts/restore.sh backups/ams-<stamp>.dump.age --into "$DATABASE_URL"
```

### What a restore does and does not recover

`raw_events` holds every delivery verbatim and is never pruned, so a
restore brings back the evidence as well as the conclusions. If scans
arrived after the last backup they are genuinely gone — but the readers
themselves hold recent transactions, and ADMS can re-send a date range
(_Device → Get transactions by date range_), which the system will
deduplicate on the way back in.

## When something looks wrong

**The register is empty.** Check Admin → People: if the directory is
empty, import it. If people are listed but everyone is "Not expected",
check Admin → Calendar for that date.

**Somebody is missing from the register.** Admin → Unknown IDs. A card the
directory does not know still records its scans; give the number a name and
the history comes with it.

**Scans have stopped arriving.** Check Admin → Failed events first. Then
check ADMS itself (_Device → Data → Transaction_) — if scans are not
arriving there either, the problem is the reader or its network, not this
system. If they are arriving in ADMS but not here, check the webhook URL
under ADMS → System → Webhook, and the `INGEST_ALLOWED_IPS` setting.

**A time is wrong for one person.** Open them in the register, press
_Correct_, and give a reason. The correction is recorded against your name
and survives recomputation.

**Finding anyone, fast.** Press Ctrl+K (⌘K on a Mac) anywhere and type a
name or a number; Enter opens them on the register. The same palette jumps
to any page and switches between light and dark.

**A parent asks for their child's record.** Reports → the child's name →
Print, or Export CSV. The file is named by enrolment number, not by name.

**Somebody asks who changed something.** Admin → Audit log, filter by
action or date, and Export CSV if they want to take it away. The export is
itself logged.

**Every time is wrong by the same amount.** That is the timezone. Admin →
Rules. Scans keep the time exactly as transmitted, so fixing the setting
and replaying re-derives every instant correctly.

**The stream says "Reconnecting".** The figures on screen are from the time
shown in the amber bar. They are not live until it goes away. The register
reconnects on its own.

## Logs

```bash
docker compose logs -f api
```

By design the logs contain no names, no enrolment numbers and no addresses,
with one deliberate exception: a refused ingest request logs its source
address and the reason, because there the address is the subject of the
event. Everything about people is in the audit log instead, which is
readable in Admin and cannot be edited or deleted by anyone.

## Upgrading

```bash
git pull
docker compose --profile prod up -d --build
```

Migrations run on boot. They are additive; none of them drop a column.
Take a backup first anyway.
