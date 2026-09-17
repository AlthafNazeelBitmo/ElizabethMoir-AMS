# Phase 6 — admin: users, calendar, rules, audit, dead letter

Gate (specification §13): _an administrator can run the system without a
developer._

Everything the school needs in order to operate this without calling anyone
now has a screen: add or remove a member of staff, reset a password, mark a
term and carve a holiday out of it, change what counts as late, import the
directory, name an unrecognised card, configure a reader, read who changed
what, and retry a delivery that failed.

Verified in a browser end to end, including that the self-lockout guard
actually reaches the user: pressing _Deactivate_ on your own account shows
"You cannot deactivate your own account. Ask another administrator."

## What was built

**Users.** List, create (with a generated password shown once), rename,
change role, deactivate and reactivate, reset password. A reset or a
deactivation ends that account's open sessions immediately, so the previous
holder does not keep their access.

**Attendance rules.** Every setting from §8 with plain-language help that
says what changing it does. All-or-nothing: if any value is invalid,
nothing is written, because half-applied rules would make the figures mean
something nobody chose.

**Calendar.** Set a term of weekdays in one request, then overwrite
individual dates as holidays. Until a date is marked a school day, nobody
can be absent on it.

**Audit log.** Filterable by action, paginated newest first, with
before/after detail on demand.

**Failed events.** The deliveries that could not be interpreted, with the
reason and the original body, and a replay button.

**Devices, people, unknown IDs.** Screens for the endpoints built in
Phase 3, including the two-step directory import with its separate
deactivation confirmation, and one-click naming of an unrecognised card.

## Dead code removed, rather than left as decoration

The first version had a "last administrator" guard that refused to remove
the only remaining admin. A test proved it **unreachable**: since you
cannot deactivate or demote _yourself_, the person making any change always
remains an active administrator, so there is always at least one way back
in. Unreachable safety code is worse than none — it reads as protection
that nobody has tested. It was removed, the two self-guards are commented
as the thing that actually preserves access, and the test now asserts the
real invariant.

## Choices made where the specification left them open

- **You cannot deactivate or demote your own account.** Both are ways to
  lock yourself out mid-session by accident and neither has a legitimate
  use; ask another administrator.
- **A password reset and a deactivation both revoke sessions.** A reset
  that left the old session working would not be a reset.
- **Generated passwords are shown once, loudly**, with the warning that
  they cannot be recovered — the same contract as the command-line tool.
- **The audit log does not show IP addresses** beside people's names. They
  are recorded for investigation, not for routine display.
- **The calendar takes a range with a weekdays-only option**, because a
  term is how a school thinks about it, not 90 individual dates.
- **Replay is one button and safe to press twice.** The processor
  deduplicates, so a delivery that half succeeded will not double anything;
  and the response says honestly whether it is still failing rather than
  claiming success.
- **`API_PORT` and `WEB_PORT`** now configure the dev servers, so a second
  instance can run alongside a first. This came out of a stuck process
  holding port 3000 during verification.

## Tests

434 passing overall, 35 new: role isolation on every system endpoint, the
user guards, session revocation on reset and deactivation, all-or-nothing
settings validation, calendar ranges and overwrites, audit filtering, and
dead-letter replay including that it is idempotent and reports honestly
when the body is genuinely bad.

## Uncertain, or deferred

- **Still no front-end tests.** Playwright is Phase 7. Everything here was
  driven by hand in a browser.
- **No group management screen.** The endpoints exist; the import rejects
  unknown group names, so a new group has to be added through the API
  first. Worth a small screen before handover.
- **No per-person report screen**, and no way to edit a tutor's full name.
- **The audit log has no export.** Reading it in the browser is fine for
  now; an investigation covering months would want CSV.
- **Bulk user import** does not exist. A school has few operator accounts,
  so one at a time is probably right.
