import { readFile } from 'node:fs/promises';
import { sql } from 'kysely';
import { Migrator } from 'kysely/migration';
import type { Kysely } from 'kysely';
import type { Database } from './index.js';

export async function migrate(db: Kysely<Database>) {
  const migrator = new Migrator({
    db,
    provider: {
      async getMigrations() {
        return {
          '001_initial': {
            async up(db: Kysely<unknown>) {
              const migration = await readFile(
                new URL('../migrations/001_initial.sql', import.meta.url),
                'utf8',
              );
              await sql.raw(migration).execute(db);
            },
            async down(db: Kysely<unknown>) {
              await sql`DROP TABLE bookings, rooms, members`.execute(db);
            },
          },
        };
      },
    },
  });

  const { error } = await migrator.migrateToLatest();
  if (error) throw error;
}
