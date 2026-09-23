# The visual system

How the front end looks, why, and how to add to it without breaking the
grammar. Read this before touching anything under `apps/web/src`.

## What it is for

A live register is read all day from across a room, by someone who is
usually doing something else. Everything here follows from that: the
numbers are large and tabular, a status is a colour _and_ a shape _and_ a
word, motion is rare and means something, and nothing scrolls except the
surface that holds the data.

## The stack

| Concern    | Choice                                                       | Why                                                                                                                     |
| ---------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| Styling    | Tailwind CSS v4, CSS-first (`@theme`), OKLCH tokens          | One token set drives light and dark by lightness alone; a status keeps its identity in both.                            |
| Primitives | Radix UI via the unified `radix-ui` package                  | Accessible dialogs, menus, tooltips, selects, checkboxes; keyboard and screen-reader behaviour we do not have to write. |
| Components | shadcn/ui idiom, written into `src/components/ui`            | Ours to shape; no upstream to fight. `data-slot` on every part.                                                         |
| Icons      | Lucide                                                       | Consistent stroke; tree-shaken.                                                                                         |
| Charts     | Recharts, loaded lazily                                      | Only three components draw a chart; the library arrives after the numbers do.                                           |
| Toasts     | Sonner                                                       | Confirmations that do not need dismissing.                                                                              |
| Palette    | cmdk                                                         | ⌘K: a person, a page, a date.                                                                                           |
| Type       | Inter Variable, self-hosted via `@fontsource-variable/inter` | The school's internet is not a dependency of its register.                                                              |

The reference points were the current shadcn/ui dashboard blocks and the
2026 crop of React admin products: collapsible icon sidebar, stat cards
with a share bar, a chart above a rich table, dark mode as a first-class
theme. Not because it is fashionable — because it is what people who use
such tools all day have converged on.

## Colour

All colour lives in `src/index.css` as CSS variables on `:root` and
`.dark`, exposed to Tailwind through `@theme inline`. Use the semantic
names — `bg-card`, `text-muted-foreground`, `border-border` — never a raw
palette colour.

Two colours come from the school's crest: the **cyan** of the monogram and
the **red** of the banner.

- `primary` is the cyan, deepened until white text passes AA on it. It is
  the one working accent: primary actions, the active navigation item, the
  "on site" status, the live indicator. Nothing else.
- `brand` is the banner red. It is reserved for the brand mark and for
  destructive actions, so it keeps its force when it appears.
- Everything else is a cool neutral scale, so the accent reads as a signal
  and not as decoration.

Status colours are deliberate and must not be "tidied":

| Status | Colour | Shape | Token |
| --- | --- | --- | --- |
| Present (`on_site`) | the cyan | filled dot | `status-onsite` |
| Departed | mid neutral | half dot | `status-departed` |
| Late | amber | hollow ring | `status-late` |
| Absent | the red, chroma pulled back | cross | `status-absent` |
| Not expected | none | dashed outline | `status-idle` |

There is no green anywhere, so red can mean "absent" without a red/green
pair that one in twelve men cannot separate. `StatusBadge` and
`StatusShape` in `src/components/status.tsx` are the only places a status
is drawn. The late flag is not shown as a tag beside a status, at the
school's request; it is counted on the Late tile and in the reports.

A **deactivated group** takes its people off the register, the rail, the
reports and the absence run with it — the school deactivates a group to
stop tracking it — until it is active again or they are moved. They stay
in the directory. The Groups screen asks before deactivating a group with
people in it.

### The school's mark

Two components, one rule. `SchoolLogo` is the whole logo — monogram,
rules, banner — and is the entire brand block at the top of the sidebar
(no name beside it, no "Attendance" under it) and the head of every
printed report. `BrandMark` is the monogram alone, for the places only a
small square fits: the collapsed rail and the sign-in form. Both prefer a
mark the school has uploaded (Admin → Rules → School mark; kept with the
other settings, served by the API, versioned so a new upload appears at
once), then the files shipped with the code under
`apps/web/public/branding/` — the logo and monogram lifted from the
school's own artwork, the monogram also in white for the sign-in field —
and, if even those fail to load, a tile in the banner red with the
school's initials. The crest's own colours (`--crest-cyan`, `--crest-red`,
`--crest-deep`, `--crest-mist`) are kept apart from the working palette:
they are used on exactly one surface, described next.

### The sign-in page

The one page seen before there is a session, and the one place the brand
is allowed to be loud. One card, two panels: on the left the *field* —
`.crest-field`, the crest's colours as layered radial gradients (the deep
blue under the white monogram, the cyan brightening into a mist, the
banner's red as a single glow), with the white monogram — the only mark on
the page — the school's name and one line about what this is; on the right
the form, which asks for an email and a password and says plainly that
accounts come from the office. On a phone the field is a band across the
top. Behind the card is `branding/sign-in.jpg`, made for this page: the
crest's colours out of focus and the monogram faint in them, veiled in
dark mode so the card still leads. The field's slow drift is the only
motion, and `prefers-reduced-motion` stops it. No sign-up, no "continue
with", no photograph of somewhere else.

## Type

Inter Variable, self-hosted. One scale, used everywhere:

| Role | Size / weight | Where |
| --- | --- | --- |
| Page title | 18px semibold, tight tracking | `PageHeader` |
| Panel title | 14px semibold | `Panel`, `CardTitle`, sheet title |
| Section label | 11px medium, uppercase, tracked | inside panels and the sheet |
| Body | 14px | prose, controls, table cells |
| Table / dense | 13px | rows in the register and admin tables |
| Label | 12px medium, muted | `Field` labels, column headers |
| Metadata | 12px muted | counts, hints, timestamps |
| Figure | 24px semibold, tabular | stat strips |

`tabular` on every number and time. No display sizes: nothing on these
screens is a headline.

## Layout

- **Sidebar** (`components/shell/Sidebar.tsx`): the logo, search trigger,
  the three destinations, the admin sections while inside admin, and the
  account menu (appearance, password, sign out). Collapses to an icon rail
  by choice. The admin sections are one list under an "Administration"
  heading, each with its icon, given room: 32px rows with a 4px gap.
- **Pages** own their header (`PageHeader`) and their controls. There is no
  top bar; the sidebar is the only chrome.
- **Surfaces**: one level of elevation. `Card` / `Panel` are bordered,
  `shadow-xs`, `rounded-xl`. Related figures share **one** surface with
  hairlines between them (the stat strips) rather than a box each; filters
  are a toolbar row, not a card. Popovers and sheets sit above with a real
  shadow. If a section could be a heading and some whitespace, it is not a
  box.
- **Breakpoints**, each designed, not squeezed:
  - **Phone (<768)**: no sidebar; a bar along the bottom with Register,
    Reports, Search, Admin, Account. The page scrolls; the register is a
    list of cards; the groups rail becomes a select; the stat strip is 2×3.
  - **Tablet (768–1023)**: the icon rail; the groups rail is still a
    select; the table tightens its columns; the stat strip is 3×2.
  - **Desk (1024+)**: the sidebar as chosen; the groups rail; the table has
    its own scroll and the page none; the stat strip is one row.
- **Density**: see Type. Row height 44px in the register, 36px in admin
  tables.

## The register

The register is the dashboard: what is, and what to do next.
`AttentionStrip` is the "what next" — cards that scanned but match nobody,
deliveries that could not be read — shown only when there is something and
only to an account that can act on it, each one click from the screen that
fixes it. They are plain chips, not warnings: the count is the information
and the link is the action, and a screen read all day must not shout. A
lost connection is likewise a quiet dashed line, and only after it has
been lost for six seconds; the reconnects a serverless host causes every
fifteen seconds are never mentioned. `StatCards` are the counts in one strip, each with a share bar
and a click that filters.
`ArrivalsSparkline` is the morning's arrivals in ten-minute slots, computed
from the rows already on screen — nothing is fetched for it. `GroupsPanel`
is the rail with a bar under each group — the accent, fading with the
share, never amber — so the half-empty form is seen before it is read;
everyone, the students and the staff are three parts ruled apart by
full-width bands, inside a rounded frame that clips its own scrollbar. `RegisterTable` is virtualised and
updates a row from the stream without a fetch; a changed row flashes once.

**The register is read A–Z by surname**, which is how a register is
read, and is where the _Order_ select rests. The surname is the last
word of the name, at the school's instruction: "Mr. G. Viraj Champika
Kumara" is a K, so initials and middle names never decide where somebody
sits. A title, a bracketed nickname, an MBE and a trailing initial are
set aside. It follows that a name the school files under a particle or a
compound — de Soysa, Weerasinghe Don — sits under its last word here;
the school was shown this and chose the simpler rule.

**The day goes on paper from the register itself.** _Download PDF_ opens
the browser's print dialogue, where the destination is "Save as PDF".
What it prints is not the screen: the table is virtualised, so
`RegisterPrintSheet` is a second, plain table of every row in view, with
the day's figures above it and a `PrintHeader` that says the date, the
filter and how many people — a sheet on a desk cannot be mistaken for
the whole school. The report screen keeps its own Print and CSV for a
range.

**Late is a student's tag.** A member of staff's row carries no _Late_
beside its status, at the school's request, and neither do their days in
the person panel. The flag itself is unchanged: it is still computed
from the group's threshold, still counted on the Late tile, still in the
reports and the export.

**Or as a feed of the door.** _Latest first_ puts the last person to come
in or go out at the top, and a scan moves its row there. That needs a
fact neither `first_in` nor `last_out` gives — the one who left at lunch
and came back has no `last_out` — so each day carries
`last_movement_at`, the last scan that counted, and the stream carries it
too; a time set by hand takes its place as a scan would. _School order_
is the third choice. The rows are sorted in the browser, like the status
filter and the search; in either fixed order a scan changes the row where
it stands and off-screen changes are counted.

**Every other list of people is in the school's order** — students before
staff, groups as the school ordered them, then each person's place in
their group if they have one, then name. The register reads that order
from the server and it is what "School order" and the untouched rows
show; the report rests on it and the Name heading cycles school order →
A–Z → Z–A → school order.

**The numbers agree with each other.** "Expected" on the tiles is the
people expected today — a group that expects attendance, on a school day
— and is nobody on a Sunday. "N of M people" under the search is the roll
in view. The rail's "in / of" is who has checked in out of who there is,
the same people the list shows when it opens, and "Everyone" on the rail
is the whole roll: people in no group get a line of their own under
"Unplaced", and a group cannot be deactivated while it has people, so the
parts always add up to the total. "Present" and "Departed" — on the tiles
and as filters — are **presence**, not status: scanned in and not out,
scanned out. Someone in the building on a day they were not expected, a
Sunday or a contractor, is counted as here; "Absent" and "Not expected"
remain the day's verdict. Someone expected who has not arrived and cannot
yet be called absent is "Not arrived" (`pending`), a status the register
alone has — the morning is mostly made of it, and it must never read
"Not expected".

The register **rests on who has checked in**. The whole roll is fetched,
so a scan brings its person on to the screen through the stream alone,
but the list shows only people with a first-in until the status filter
says otherwise: "Everyone" is one choice away, in the select, on the
"Expected" tile, and on the empty state that says nobody checked in
matches a search. A school of six hundred names with a dash beside most
of them is not a register of who is here.

`PersonSheet` is **non-modal** on purpose: the register stays readable and
clickable beside it, so the next person is one click away and a screen
reader keeps the table. Escape and the close button dismiss it; a click
elsewhere does not.

Everything the register shows is in the URL — date, branch, group, status,
search, open person — so the palette, a shared link, a bookmark and the
back button all land on the same screen. Every URL update reads the live
`window.location`, never a render's snapshot: React Router's functional
updater still hands you the last render's params, and a debounced search
firing a tick after a row click would otherwise close the person it just
opened.

## Motion

Three animations start on their own: the row flash on a live scan, the
count pulse when a number changes, and the live-dot breath. A page fades in
over 150ms on navigation. Everything else is a 150–300ms enter/exit on
things the person opened. `prefers-reduced-motion` removes all of it.

## Dark mode

`src/lib/theme.ts`: light, dark, or follow the system; chosen per browser
from the account menu or the palette; applied before first paint so there
is no flash. Print is always light.

## Paper

The two report pages print. The screen is a fixed frame whose surfaces
scroll; paper flows and breaks, so `@media print` in `index.css` undoes
every fixed height and overflow, drops the shell, and the report pages
put a `PrintHeader` where their controls were: the logo, the school, the
report's name, what it covers, and who prepared it when. Column headings
repeat on every page a table runs on to — which the browser refuses to
do for a heading that holds a button, so the sortable headings give up
their button box on paper. `usePrintSetup` sets the light palette and the
document title for the duration of printing, so a dark screen prints
light and "Save as PDF" names the file after the report.
`print-color-adjust: exact` keeps the status colours; the aggregate row's
tint survives. The person page's charts print at the width they had on
screen.

## Adding a screen

1. Wrap it in `PageHeader` + `Card`/`Panel`. Use `Field` for a labelled
   control (it wraps the control in a `<label>`, so tests and assistive
   technology find it by name with no ids).
2. Give it the four states: `TableSkeleton`/`CardSkeleton` while loading,
   `EmptyState` with a next step, `ErrorState` with a retry, and the data.
3. Confirm a mutation with `toast.success(...)`; show a refused one with
   `Problem`.
4. Keep every filter in the URL.
5. Check it in both themes and at 375px before calling it done.
