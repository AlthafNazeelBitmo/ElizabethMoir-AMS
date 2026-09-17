#!/usr/bin/env bash
#
# A daily encrypted backup of the database.
#
#   scripts/backup.sh                    # one backup, into ./backups
#   BACKUP_DIR=/srv/backups scripts/backup.sh
#
# Needs DATABASE_URL and BACKUP_PASSPHRASE in the environment (both are in
# .env on the server). Encrypted with age if available, otherwise with
# gpg's symmetric mode; a plain dump is refused, because this file contains
# the movement history of every child in the school.

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

[ -n "${DATABASE_URL:-}" ] || { echo "error: DATABASE_URL is not set" >&2; exit 1; }
[ -n "${BACKUP_PASSPHRASE:-}" ] || {
  echo "error: BACKUP_PASSPHRASE is not set. An unencrypted backup of this" >&2
  echo "       database is not acceptable; set one and store it separately" >&2
  echo "       from the backups themselves." >&2
  exit 1
}

mkdir -p "$BACKUP_DIR"
PLAIN="$BACKUP_DIR/ams-$STAMP.dump"

echo "==> Dumping"
# Custom format: compressed, and restorable table by table.
pg_dump --format=custom --no-owner --no-privileges --file="$PLAIN" "$DATABASE_URL"

echo "==> Encrypting"
if command -v age >/dev/null 2>&1; then
  printf '%s' "$BACKUP_PASSPHRASE" | age --passphrase --output "$PLAIN.age" "$PLAIN" 2>/dev/null \
    || age --passphrase --output "$PLAIN.age" "$PLAIN"
  ENCRYPTED="$PLAIN.age"
elif command -v gpg >/dev/null 2>&1; then
  printf '%s' "$BACKUP_PASSPHRASE" \
    | gpg --batch --yes --passphrase-fd 0 --symmetric --cipher-algo AES256 --output "$PLAIN.gpg" "$PLAIN"
  ENCRYPTED="$PLAIN.gpg"
else
  rm -f "$PLAIN"
  echo "error: neither age nor gpg is installed; refusing to leave a plain dump" >&2
  exit 1
fi

shred -u "$PLAIN" 2>/dev/null || rm -f "$PLAIN"

echo "==> Pruning backups older than $RETENTION_DAYS days"
find "$BACKUP_DIR" -name 'ams-*.dump.*' -mtime "+$RETENTION_DAYS" -print -delete

SIZE="$(du -h "$ENCRYPTED" | cut -f1)"
echo
echo "  $ENCRYPTED ($SIZE)"
echo
echo "  A backup nobody has restored is a hope, not a backup."
echo "  Rehearse it: scripts/restore.sh $ENCRYPTED"
echo
