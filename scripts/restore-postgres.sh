#!/bin/sh
set -eu

if [ "$#" -ne 1 ] || [ -z "${PGDATABASE:-}" ]; then
  echo "usage: PGHOST=... PGUSER=... PGDATABASE=... scripts/restore-postgres.sh INPUT.dump" >&2
  exit 64
fi

input=$1
pg_restore --list "$input" >/dev/null
pg_restore \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  --exit-on-error \
  --dbname="$PGDATABASE" \
  "$input"
echo "restored and verified PostgreSQL backup: $input"
