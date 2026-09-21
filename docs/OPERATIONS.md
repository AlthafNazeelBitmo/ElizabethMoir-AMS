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
   "School". Upload the crest there too (PNG, JPEG, SVG or WebP under
   512 KB): it appears in the sidebar and on the sign-in page at once.
2. **Set the calendar.** Admin → Calendar. Until a date is marked a school
   day, nobody can be absent on it — so absence reporting says nothing
   until this is done. Set the term as weekdays, then carve out holidays.
3. **Import the directory.** Admin → People, or from a checkout:
   `pnpm --filter @ams/api import-directory people.csv --confirm`. Every
   group named in the file must already exist under Admin → Groups (the
   standard forms and staff groups are there from the start); tutors are
   created as the file names them. A row may leave `group` (and `branch`)
   blank — the readers' own export does, for anyone nobody has classified
   — and that person joins the directory in no group, expected nowhere,
   until the office places them: filter People by _No group_. A blank
   group or tutor in the file never clears one the office has set by hand;
   clearing is done on the person's edit form.

   **The school's order.** Every list — the register, the reports — runs
   students before staff, groups in the order set under Admin → Groups,
   and within a group each person's _place in list_ if they have one (1
   first), then the rest by name. The staff are placed from the school's
   own list: give the file a `display_order` column with the place, or set
   it on a person's edit form. Students have no places and stay
   alphabetical within their form.

   **Categories.** The school's staff list also puts each member of staff
   in a category — HOD, Teaching, Extra-Curricular, Admin, Service,
   Part-Time — and it is shown beside their group on the register, in the
   reports and their CSV export, and in the directory. It comes in from a
   `category` column in the file, or is set on the edit form, which offers
   the categories already in use so spellings stay consistent. It is free
   text: a new category needs no deploy. A blank never clears one.

   **A file that is a part of the school** — one branch, the staff list —
   is imported without touching anyone it does not mention: the preview
   asks whether the file is the whole school or a part, and nothing is
   deactivated unless you say it is the whole.
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

**A whole group should not be on the register.** Admin → Groups → untick
_Active_. Its people come off the register, the rail and the reports with
it, and nobody in it is marked absent, until it is active again or they are
moved to another group; they stay in the directory meanwhile. (A group
that should be on the register but not expected to attend — contractors —
is a different thing: leave it active and untick _Expects attendance_.)

**The register is empty.** It shows who has checked in; before the first
scan of the day it says so, and _Show everyone_ (or the status filter set
to _Everyone_) lists the whole roll. If the roll itself is empty, check
Admin → People and import the directory. If people are listed but
everyone is "Not expected", check Admin → Calendar for that date — a day
nobody has entered is not a school day.

**Somebody is missing from the register.** Admin → Unknown IDs. A card the
directory does not know still records its scans; give the number a name and
the history comes with it.

**A number on Unknown IDs that is nobody's.** A test card, a probe, a
number enrolled on the reader by mistake: the bin icon on its row removes
the number and the scans nobody owns (the readers' original deliveries
are kept). If the card scans again the number simply reappears. A
deactivated person's number cannot be removed this way — reactivate or
delete them under People.

**A deactivated person keeps scanning.** Their card still opens the reader.
The scans are not filed under a record the register no longer shows: the
number goes back to Admin → Unknown IDs, marked _Was <name>, deactivated_,
with a _Reactivate_ button that brings them back and claims those scans. A
number is never given to a second person while a deactivated one holds it.

**Somebody tapped in and out and nothing changed.** Two taps on the same
reader within the repeat-tap window (Admin → Rules; 60 seconds by default)
are one movement — people tap twice. The window runs from the tap that
counted, so a real in-and-out needs more than a minute between them. When
testing a reader, wait the minute; the scan count on the person's sheet
still goes up for every tap, so nothing is lost.

**Scans have stopped arriving.** Check Admin → Failed events first. Then
check ADMS itself (_Device → Data → Transaction_) — if scans are not
arriving there either, the problem is the reader or its network, not this
system. If they are arriving in ADMS but not here, check the webhook URL
under ADMS → System → Webhook, and the `INGEST_ALLOWED_IPS` setting.

**A time is wrong for one person.** An administrator opens them in the
register and presses _Correct_: first-in and last-out times, the status,
and a reason. The correction is recorded against your name and survives
recomputation. A student-only account can read a day but not change one.

**Finding anyone, fast.** Press Ctrl+K (⌘K on a Mac) anywhere and type a
name or a number; Enter opens them on the register. The same palette jumps
to any page and switches between light and dark.

**A new pupil or member of staff joins.** Admin → People → _Add person_:
the enrolment number exactly as ADMS has it, the name, the group. If they
have already scanned, their scans attach the moment they are saved. For a
whole intake, import the spreadsheet instead. Leavers: _Actions → Deactivate_
on their row — off the register, history kept, reversible. _Show
deactivated_ lists the leavers on their own; from there _Actions →
Delete…_ removes one for good, with their attendance history and scans
(the readers' original deliveries are kept). It asks twice and cannot be
undone; deactivating is the normal thing, deleting is for a record that
should never have existed. The list filters by branch, group and tutor and
pages fifty at a time.

**A new tutor.** Admin → People → _Tutors_: initials and, if you like, a
name. The spreadsheet creates tutors as it meets them, so this is only for
one who joins between imports. A tutor with people cannot be removed —
filter People by that tutor, move them, then remove.

**A parent asks for their child's record.** Reports → the child's name →
Print, or Export CSV. The file is named by enrolment number, not by name.
_Print_ opens the browser's print dialog laid out as a sheet — the
school's logo, the name, the range, who prepared it and when — and "Save
as PDF" there makes the PDF, named after the report. Untick the browser's
own "Headers and footers" for a clean page; that line of URL and date is
the browser's, not the report's.

**A failed delivery that will never succeed.** Admin → Failed events →
_Dismiss_. It is set aside, not deleted — body and reason kept, your name
against it, and _Show dismissed_ → _Restore_ brings it back. Use it for
test posts and probes; a delivery that failed for a reason worth fixing is
replayed after the fix, not dismissed.

**Somebody asks who changed something.** Admin → Audit log, filter by
action or date, and Export CSV if they want to take it away. The export is
itself logged.

**Every time is wrong by the same amount.** That is the timezone. Admin →
Rules. Scans keep the time exactly as transmitted, so fixing the setting
and replaying re-derives every instant correctly.

**The register says "Connection lost".** The figures on screen are as of
the time shown. The register reconnects on its own — a drop of a few
seconds is never mentioned — and if it comes back to a different server
process, after a restart say, it fetches the screen again rather than
trusting that nothing happened in between.

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
