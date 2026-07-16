# PostgreSQL backup and restore

Use PostgreSQL 17 client tools matching the production major version. Store encrypted backups in a
separate failure domain with restricted access, immutable retention where available, and a tested
expiry policy. The scripts use libpq environment variables rather than putting credentials in
process arguments. Prefer `PGPASSFILE` to `PGPASSWORD` for scheduled jobs.

```sh
chmod +x scripts/backup-postgres.sh scripts/restore-postgres.sh
PGHOST=db.internal PGUSER=chat_backup PGDATABASE=chat_core PGPASSFILE=/run/secrets/pgpass \
  scripts/backup-postgres.sh chat-core.dump
```

Restore into a new, empty validation database first:

```sh
PGHOST=db.internal PGUSER=chat_restore PGDATABASE=chat_core_restore PGPASSFILE=/run/secrets/pgpass \
  scripts/restore-postgres.sh chat-core.dump
DATABASE_URL='postgresql://.../chat_core_restore' \
  npm run test:integration --workspace @formation-chat-core/server
```

Confirm migrations, tenant/site row counts, a representative transcript, audit records, and queued
run/handoff idempotency records. Never restore over production during a drill. For an incident,
stop writers, record the recovery point, restore to a new database, run the checks, switch the
application connection, monitor errors and queue depth, and retain the former database until the
rollback window closes. Run this drill at least quarterly and after PostgreSQL major upgrades.
