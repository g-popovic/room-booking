import { createDatabase } from './index.js';
import { migrate } from './migrate.js';
import { seed } from './seed.js';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('Set DATABASE_URL before running database setup.');

const db = createDatabase(url);
try {
  await migrate(db);
  await seed(db);
  console.log('Database is ready.');
} finally {
  await db.destroy();
}
