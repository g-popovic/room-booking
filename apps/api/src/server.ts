import { createDatabase } from '@room-booking/db';
import { createApp } from './app.js';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('Set DATABASE_URL before starting the API.');

const db = createDatabase(url);
createApp(db).listen(4000, '127.0.0.1', () =>
  console.log('Room booking API: http://127.0.0.1:4000'),
);
