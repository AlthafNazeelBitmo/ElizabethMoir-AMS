# Phase 5 — reports, exports, print layout

Gate (specification §13): _figures reconcile against raw scans._

**Met.** There are four reconciliation tests that check the report against
the rows underneath it rather than against itself: present days equal the
days with an arrival scan, present plus absent equals the day records that
expected the person, late days equal the records flagged late, and neither
a day outside the range nor a `not_expected` day moves any figure.

## A gap this phase exposed

Reports could not be built until something materialised absences. The
processor only ever recomputes a person-day that has scans, so **somebody
who never came had no row at all** — their absence existed only as the lack
of a record, which no report can count. The specification asks for the day
computation to run "nightly for all people on school days"; that job did
not exist.

`markAbsences(date)` now does it, and runs on the same schedule as the
processing drain (an interval on a long-running host, Vercel Cron on
serverless). It is idempotent, creates nothing before the day has reached
the point where absence is meaningful, and never touches an existing or
manually corrected record — so running it every few minutes is free, and
running it only at midnight would have left the register wrong all day.

## The definitions, which matter more than the query

```
present   the day was a school day, they were expected, and they came
absent    the day was a school day, they were expected, and they did not
expected  present + absent — the denominator, never the calendar length
```

A day nobody expected them for — a holiday, a contractor, a date the
calendar does not know — counts in neither, so it cannot move a percentage.
Somebody with nothing expected of them in the range gets a **null**
percentage, rendered as an em dash: no denominator means no figure, not
zero per cent.

## What was built

`GET /api/reports/attendance` with `from`, `to`, `branch`, `group`, `tutor`
and `format=json|csv`, and `GET /api/reports/person/:id`. The web Reports
screen: date range with Today / This week / This month, branch and group
filters, every column sortable, the aggregate pinned above the rows, CSV
export, and a print stylesheet.

## Choices made where the specification left them open

- **The aggregate arrival is weighted by days, not a mean of means.**
  Somebody present twice must not count the same as somebody present forty
  times.
- **Nulls always sort last**, whichever direction is chosen. "No data" is
  not a small number and should not lead the table.
- **The CSV is protected against formula injection.** A value starting `=`,
  `+`, `-` or `@` is executed when a spreadsheet opens the file; names come
  from an uploaded file and enrolment numbers from an unauthenticated
  webhook, so neither is trusted enough to hand over unescaped.
- **The CSV carries a preamble** — range, filters, school days, generated
  timestamp — and a byte-order mark with CRLF, so a file found on a desk in
  March still explains itself and Excel renders names rather than mojibake.
- **An export is audited; a JSON read is not.** An export leaves the
  building.
- **Ranges longer than 400 days are refused** rather than served slowly.
- **Export is a plain link, not a fetch-and-blob**, so the browser uses the
  filename the server chose.
- **The printed sheet carries the school name, the range and the filters**,
  and drops the navigation and controls. A printout that does not say what
  it covers is worse than none.

## Tests

399 passing overall, 32 new: the counts and averages, the four
reconciliation checks, role isolation (including that a staff member stays
out of a `student_only` account's CSV), the CSV's quoting and formula
defusing, and the export audit entry.

## Uncertain, or deferred

- **The print layout has not been checked on paper**, only in the
  stylesheet. Page breaks across a long table are the thing to look at.
- **`SCHOOL_NAME` is a constant in the front end.** It belongs in settings
  beside the timezone; there is no endpoint serving it yet.
- **No per-person report screen.** The endpoint exists and is tested; the
  person panel on the register covers the same ground for now.
- **Average arrival ignores the late threshold.** It is a plain mean of
  arrival times, which is what was asked for, but a single very late
  morning moves it more than most people would expect.
