# Database migration policy

The server runs all pending Kysely migrations before it starts listening. Migration names are
ordered, immutable, and committed with the code that requires them. Running the same release more
than once is safe because Kysely records completed migrations in PostgreSQL.

Production recovery is roll-forward: fix a failed or incorrect migration with a new migration and
deploy it. Never edit or rename a migration that may have run outside a disposable environment.
Take a database backup before applying a release that contains a destructive migration.

Each migration includes a `down` function for local development and an immediately failed rollout.
Do not automatically migrate production down. A rollback that would discard data requires an
operator-reviewed recovery plan and a verified backup. Application rollback is only safe while the
older application remains compatible with the migrated schema.
