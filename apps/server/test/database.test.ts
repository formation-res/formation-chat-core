import { describe, expect, it } from 'vitest';

import { DatabaseMigrationError } from '../src/database/migrate.js';

describe('DatabaseMigrationError', () => {
  it('does not expose the underlying database failure', () => {
    expect(new DatabaseMigrationError()).toMatchObject({
      name: 'DatabaseMigrationError',
      message: 'Database migration failed.',
    });
  });
});
