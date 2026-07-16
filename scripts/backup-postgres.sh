#!/bin/sh
set -eu
umask 077

if [ "$#" -ne 1 ] || [ -z "${PGDATABASE:-}" ]; then
  echo "usage: PGHOST=... PGUSER=... PGDATABASE=... scripts/backup-postgres.sh OUTPUT.dump" >&2
  exit 64
fi

output=$1
pg_dump \
  --format=custom \
  --compress=9 \
  --no-owner \
  --no-privileges \
  --file="$output"
pg_restore --list "$output" >/dev/null
echo "verified PostgreSQL backup: $output"
