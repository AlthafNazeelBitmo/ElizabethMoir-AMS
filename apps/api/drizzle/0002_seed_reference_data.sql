-- Reference data a fresh deployment needs in order to be usable at all.
--
-- Every statement is idempotent, so re-running a migration set against an
-- existing database changes nothing. Names and values here are all editable
-- by an administrator afterwards; nothing in the application reads them by
-- name.

-- ── Groups (specification §5) ─────────────────────────────────────────────
-- External Staff deliberately has expects_attendance = false: contractors
-- must not appear in an absence list.
INSERT INTO "groups" ("name", "branch", "display_order", "expects_attendance") VALUES
  ('Form 1',       'student', 1, true),
  ('Form 2',       'student', 2, true),
  ('Form 3',       'student', 3, true),
  ('Form 4',       'student', 4, true),
  ('Form 5',       'student', 5, true),
  ('Lower 6',      'student', 6, true),
  ('Upper 6',      'student', 7, true),
  ('Junior Staff', 'staff',   1, true),
  ('Senior Staff', 'staff',   2, true),
  ('Senior Admin', 'staff',   3, true),
  ('External Staff','staff',  4, false)
ON CONFLICT ("name") DO NOTHING;
--> statement-breakpoint

-- ── Attendance rules (specification §8) ───────────────────────────────────
-- Defaults only. `timezone` in particular is provisional: it is set from the
-- evidence available before the discovery run (the reader's transaction
-- times read as Sri Lanka local time) and must be confirmed against the
-- Phase 0 report before any late or absent figure is trusted.
INSERT INTO "settings" ("key", "value") VALUES
  ('timezone',                '"Asia/Colombo"'::jsonb),
  ('late_threshold_default',  '"08:00"'::jsonb),
  ('duplicate_window_seconds','60'::jsonb),
  ('day_rollover_time',       '"03:00"'::jsonb)
ON CONFLICT ("key") DO NOTHING;
