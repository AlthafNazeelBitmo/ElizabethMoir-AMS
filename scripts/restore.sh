#!/usr/bin/env bash
#
# Restores a backup, and checks that it worked.
#
#   scripts/restore.sh backups/ams-20260917T000000Z.dump.age            # rehearsal
#   scripts/restore.sh backups/ams-....dump.age --into "$DATABASE_URL"  # for real
#
# With no --into, it restores into a scratch database and reports the row
# counts, leaving the live one untouched. That is the rehearsal the
# specification asks for, and it is safe to run on a working system.

set -euo pipefail

ARCHIVE="${1:-}"
[ -n "$ARCHIVE" ] || { echo "usage: restore.sh <archive> [--into <database-url>]" >&2; exit 1; }
[ -f "$ARCHIVE" ] || { echo "error: $ARCHIVE does not exist" >&2; exit 1; }
[ -n "${BACKUP_PASSPHRASE:-}" ] || { echo "error: BACKUP_PASSPHRASE is not set" >&2; exit 1; }

TARGET=""
if [ "${2:-}" = "--into" ]; then TARGET="${3:-}"; fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
PLAIN="$WORK/restore.dump"

echo "==> Decrypting"
case "$ARCHIVE" in
  *.age) printf '%s' "$BACKUP_PASSPHRASE" | age --decrypt --output "$PLAIN" "$ARCHIVE" ;;
  *.gpg) printf '%s' "$BACKUP_PASSPHRASE" \
           | gpg --batch --yes --passphrase-fd 0 --decrypt --output "$PLAIN" "$ARCHIVE" ;;
  *) echo "error: unrecognised archive type" >&2; exit 1 ;;
esac

if [ -z "$TARGET" ]; then
  # A rehearsal: a scratch database, dropped afterwards.
  [ -n "${DATABASE_URL:-}" ] || { echo "error: DATABASE_URL is not set" >&2; exit 1; }
  SCRATCH="ams_restore_check_$(date -u +%s)"
  ADMIN_URL="${DATABASE_URL%/*}/postgres"
  echo "==> Creating scratch database $SCRATCH"
  psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$SCRATCH\""
  TARGET="${DATABASE_URL%/*}/$SCRATCH"
  CLEANUP_SCRATCH=1
fi

echo "==> Restoring"
pg_restore --no-owner --no-privileges --clean --if-exists --dbname="$TARGET" "$PLAIN"

echo
echo "==> What came back"
psql "$TARGET" -v ON_ERROR_STOP=1 -At -c "
  select 'people          ' || count(*) from people
  union all select 'scans           ' || count(*) from scans
  union all select 'day_records     ' || count(*) from day_records
  union all select 'raw_events      ' || count(*) from raw_events
  union all select 'users           ' || count(*) from users
  union all select 'audit_log       ' || count(*) from audit_log
  union all select 'latest scan     ' || coalesce(max(att_time)::text, 'none') from scans
"

if [ "${CLEANUP_SCRATCH:-0}" = "1" ]; then
  echo
  echo "==> Dropping the scratch database"
  psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -c "DROP DATABASE \"$SCRATCH\""
  echo
  echo "  Rehearsal complete. The live database was not touched."
fi
echo
