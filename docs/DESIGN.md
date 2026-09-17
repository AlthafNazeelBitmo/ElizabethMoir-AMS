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

## Tokens

All colour lives in `src/index.css` as CSS variables on `:root` and
`.dark`, exposed to Tailwind through `@theme inline`. Use the semantic
names — `bg-card`, `text-muted-foreground`, `border-border` — never a raw
palette colour. The one accent is `primary` (the school's indigo). It is
used for primary actions, the active navigation item, the "on site" status
and the live indicator, and nothing else.

Status colours are deliberate and must not be "tidied":

| Status       | Colour           | Shape          | Token             |
| ------------ | ---------------- | -------------- | ----------------- |
| On site      | indigo           | filled dot     | `status-onsite`   |
| Departed     | mid neutral      | half dot       | `status-departed` |
| Late         | amber            | hollow ring    | `status-late`     |
| Absent       | desaturated rose | cross          | `status-absent`   |
| Not expected | none             | dashed outline | `status-idle`     |

There is no red/green pairing anywhere. Someone with deuteranopia cannot
separate those, and a register that one in twelve men cannot read is not
a register. `StatusBadge` and `StatusShape` in `src/components/status.tsx`
are the only places a status is drawn.

## Layout

- **Sidebar** (`components/shell/Sidebar.tsx`): brand, search trigger,
  the three destinations, the admin sections while inside admin, and the
  account menu (appearance, password, sign out). Collapses to an icon rail
  by choice, and always below 1024px.
- **Pages** own their header (`PageHeader`) and their controls. There is no
  top bar; the sidebar is the only chrome.
- **Surfaces**: `Card` / `Panel` are bordered, `shadow-xs`, `rounded-xl`.
  One level of elevation. Popovers and sheets sit above with a real shadow.
- **Density**: 14px body, 13px tables, 11px labels. `tabular` on every
  number and time.

## The register

`StatCards` are the counts, each with a share bar and a click that filters.
`ArrivalsSparkline` is the morning's arrivals in ten-minute slots, computed
from the rows already on screen — nothing is fetched for it. `GroupsPanel`
is the rail with an on-site bar under each group so the half-empty form is
seen before it is read. `RegisterTable` is virtualised and updates a row in
place from the stream; a changed row flashes once.

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
count pulse when a number changes, and the live-dot breath. Everything else
is a 150–300ms enter/exit on things the person opened. `prefers-reduced-
motion` removes all of it.

## Dark mode

`src/lib/theme.ts`: light, dark, or follow the system; chosen per browser
from the account menu or the palette; applied before first paint so there
is no flash. Print is always light.

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
