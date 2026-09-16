# Phase 3 — people, groups, devices, CSV import, unknown IDs

Gate (specification §13): _full directory loaded from a real spreadsheet._

## What was built

**The directory provider seam** (`src/directory/provider.ts`).
`PersonDirectoryProvider` with `listAll`, `findByEnrollNo` and
`supportsLiveSync`; `CsvDirectoryProvider` ships. Nothing outside that
folder knows which implementation is in use. The vendor-API provider is a
documented seam rather than a stub that pretends to work — ADMS does hold
names, so it is a realistic second implementation, but VFT have published
no documentation and we have no service credential, and inventing one now
would be guesswork that looks like a feature.

**CSV handling** in three pure, separately tested pieces:

- `csv.ts` — a small RFC 4180 parser. A dependency was the obvious
  alternative; this is a deliberate choice, because the input is one narrow
  shape and the failure modes that matter (a byte-order mark, CRLF, a
  quoted field containing a comma or newline, doubled quotes) are each
  covered by a test. Reconsider if the format ever widens.
- `validate.ts` — every row checked, never stopping at the first problem,
  each problem naming the line and the column.
- `plan.ts` — the diff: creates, updates, deactivations, unchanged, new
  tutors, and a fingerprint of the whole thing.

**The two-step import.** `POST /api/admin/people/import` previews and
writes nothing. `POST /api/admin/people/import/confirm` rebuilds the plan,
compares the fingerprint, and applies it in one transaction. If the
directory moved in between, the administrator sees the new diff instead of
silently applying a stale one. Deactivations need a second, explicit
confirmation, and are listed in full rather than sampled — nobody should
approve removing people they cannot see.

**Unknown enrolment numbers.** Listed with counts and first/last seen, and
attachable to a new or existing person in one request. Attaching claims the
scans already recorded against that number and recomputes the days they
fall in, so the register reflects them at once.

**Admin endpoints** for people, groups, devices and tutors, all `full` role
only, all paginated (default 50, maximum 200), all audited.

**A command-line importer**, so a real spreadsheet can be loaded before the
web interface exists:

```bash
pnpm --filter @ams/api import-directory people.csv            # preview
pnpm --filter @ams/api import-directory people.csv --confirm  # apply
```

It goes through the same planner and the same confirmation as the endpoint.
`docs/directory-template.csv` is a starting file for the school.

## A bug the tests caught, worth naming

The plan fingerprint originally covered only the _enrolment numbers_ of
people to be created. That meant a file could be swapped between preview
and confirm for one with the same numbers and different names, and the
check that exists to prevent exactly that would have passed. It now covers
the whole content of every created record.

## Choices made where the specification left them open

- **A row whose `branch` and `group` disagree is an error**, not something
  to reconcile. It is the mistake most likely to put a member of staff in
  front of a student-only account.
- **Unknown group names are rejected** rather than created, so a typo
  cannot quietly add "Form 11" to the school. Tutors _are_ created from the
  file, because there is no other way to create one.
- **Group names match case- and space-insensitively.** A spreadsheet will
  say "form 1"; meaning something different by that is not plausible.
- **Re-importing someone previously deactivated brings them back**, and it
  shows in the preview as an `is_active` change rather than happening
  invisibly.
- **Attaching an unknown number to a person who already has a different
  one is refused**, not guessed at: their old number would stop matching
  and their history would split.
- **The preview samples creates and updates at 25** but lists every
  deactivation, and says how many were truncated.
- **Uploads are capped at 5 MB** (`MAX_UPLOAD_BYTES`). A whole school is
  thousands of rows.
- **`text/csv`, `text/plain` and multipart are all accepted**, registered
  inside the admin plugin's scope so the ingest endpoint's own parser rules
  are untouched.

## Tests

325 passing overall, 70 new: 37 on parsing, validation and planning; 33 on
the endpoints end to end, including that a `student_only` account is
refused from every admin route, that an invalid row writes nothing at all,
that a re-import updates rather than duplicates, that deactivation needs
its second confirmation, and that a stale or swapped file is rejected.

## Uncertain, or deferred

- **No real spreadsheet has been imported yet.** The gate is not met until
  the school's actual export goes through — that is the point at which
  encodings, stray columns and unexpected group names show up. The template
  and the CLI exist so that can happen as soon as a file arrives.
- **The import is synchronous.** Fine for a few thousand rows; a school
  ten times this size would want it backgrounded.
- **No `/admin/tutors` write endpoint.** The specification lists none, and
  the import creates them. Editing a tutor's full name has no route yet.
- **Photos** (`people.photo_url`) are in the schema and nothing populates
  them.
