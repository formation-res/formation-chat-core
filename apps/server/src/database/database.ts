import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';

import type { ServerConfig } from '../config.js';
import type { DatabaseSchema } from './types.js';

export type Database = Kysely<DatabaseSchema>;

export function createDatabase(
  config: Pick<ServerConfig, 'databaseUrl' | 'databasePoolMax'>,
): Database {
  return new Kysely<DatabaseSchema>({
    dialect: new PostgresDialect({
      pool: new pg.Pool({ connectionString: config.databaseUrl, max: config.databasePoolMax }),
    }),
  });
}

export async function checkDatabase(database: Database): Promise<void> {
  await sql`select 1`.execute(database);
}
