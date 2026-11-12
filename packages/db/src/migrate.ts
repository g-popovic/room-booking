import { readFile } from 'node:fs/promises';
import { sql } from 'kysely';
import { Migrator } from 'kysely/migration';
import type { Kysely } from 'kysely';

import type { Database } from './types.js';

async function runSqlMigration(db: Kysely<unknown>, filename: string) {
  const migration = await readFile(
    new URL(`../migrations/${filename}`, import.meta.url),
    'utf8',
  );

  await sql.raw(migration).execute(db);
}

export async function migrate(db: Kysely<Database>) {
  const migrator = new Migrator({
    db,
    provider: {
      async getMigrations() {
        return {
          '001_initial': {
            async up(db: Kysely<unknown>) {
              await runSqlMigration(db, '001_initial.sql');
            },
            async down(db: Kysely<unknown>) {
              await sql`DROP TABLE bookings, rooms, members`.execute(db);
            },
          },
          '002_member_admin': {
            async up(db: Kysely<unknown>) {
              await runSqlMigration(db, '002_member_admin.sql');
            },
            async down(db: Kysely<unknown>) {
              await sql`ALTER TABLE members DROP COLUMN is_admin`.execute(db);
            },
          },
          '003_calendar_feeds': {
            async up(db: Kysely<unknown>) {
              await runSqlMigration(db, '003_calendar_feeds.sql');
            },
            async down(db: Kysely<unknown>) {
              await sql`DROP TABLE calendar_feeds`.execute(db);
            },
          },
        };
      },
    },
  });

  const { error } = await migrator.migrateToLatest();

  if (error) throw error;
}
