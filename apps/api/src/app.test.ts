import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { after, before, test } from 'node:test';
import { createDatabase } from '@room-booking/db';
import { migrate } from '@room-booking/db/migrate';
import { seed } from '@room-booking/db/seed';
import { createApp } from './app.js';

const url = process.env.TEST_DATABASE_URL;
if (!url || url === process.env.DATABASE_URL) {
  throw new Error(
    'Set TEST_DATABASE_URL to a separate Postgres test database.',
  );
}

const db = createDatabase(url);
const now = new Date('2032-06-10T06:00:00Z');
const details = {
  name: `Test room ${randomUUID()}`,
  description: 'A fictional room for testing.',
  capacity: 4,
  amenities: ['Whiteboard'],
};
let server: Server;
let origin: string;
let roomId: number;

before(async () => {
  await migrate(db);
  await seed(db);
  const room = await db
    .insertInto('rooms')
    .values(details)
    .returning('id')
    .executeTakeFirstOrThrow();
  roomId = room.id;
  server = createApp(db, () => now).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  origin = `http://127.0.0.1:${address.port}/api`;
});

after(async () => {
  try {
    if (server)
      await new Promise<void>((resolve) => server.close(() => resolve()));
    if (roomId) {
      await db.deleteFrom('bookings').where('room_id', '=', roomId).execute();
      await db.deleteFrom('rooms').where('id', '=', roomId).execute();
    }
  } finally {
    await db.destroy();
  }
});

function request(path: string, method: string, cookie = '', body?: unknown) {
  return fetch(origin + path, {
    method,
    headers: {
      Cookie: cookie,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function signIn(id: string) {
  const response = await request('/session', 'POST', '', { id });
  assert.equal(response.status, 200);
  const cookie = response.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie);
  return cookie;
}

test('room permissions follow the stored admin flag for an existing session', async () => {
  const id = randomUUID();
  const updated = { ...details, capacity: 5 };

  await db.insertInto('members').values({ id, name: 'Test member' }).execute();

  try {
    const cookie = await signIn(id);

    assert.equal(
      (await request(`/rooms/${roomId}`, 'PUT', cookie, updated)).status,
      403,
    );

    await db
      .updateTable('members')
      .set({ is_admin: true })
      .where('id', '=', id)
      .execute();

    const session = await request('/session', 'GET', cookie);
    assert.equal((await session.json()).account.isAdmin, true);

    const response = await request(`/rooms/${roomId}`, 'PUT', cookie, updated);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).capacity, 5);

    await db
      .updateTable('members')
      .set({ is_admin: false })
      .where('id', '=', id)
      .execute();

    assert.equal(
      (await request(`/rooms/${roomId}`, 'PUT', cookie, updated)).status,
      403,
    );
  } finally {
    await db.deleteFrom('members').where('id', '=', id).execute();
  }
});

test('a concurrent overlap gets rejected and cancellation releases the slot', async () => {
  const alex = await signIn('alex');
  const sam = await signIn('sam');
  const start = '2032-06-10T08:00:00.000Z';
  const end = '2032-06-10T09:00:00.000Z';
  const body = { roomId, start, end };
  assert.equal((await request('/bookings', 'POST', '', body)).status, 401);

  const results = await Promise.all([
    request('/bookings', 'POST', alex, body),
    request('/bookings', 'POST', sam, body),
  ]);
  assert.deepEqual(results.map((result) => result.status).sort(), [201, 409]);
  const won = results[0].status === 201 ? 0 : 1;
  const { id } = await results[won].json();
  const [owner, other] = won === 0 ? [alex, sam] : [sam, alex];
  assert.equal((await request(`/bookings/${id}`, 'DELETE', other)).status, 404);
  assert.equal(
    (
      await request('/bookings', 'POST', other, {
        ...body,
        start: end,
        end: '2032-06-10T09:30:00.000Z',
      })
    ).status,
    201,
  );
  assert.equal((await request(`/bookings/${id}`, 'DELETE', owner)).status, 204);
  assert.equal((await request(`/bookings/${id}`, 'DELETE', owner)).status, 204);

  const schedule = await (
    await request('/rooms?date=2032-06-10', 'GET')
  ).json();
  const room = schedule.rooms.find(
    (room: { id: number }) => room.id === roomId,
  );
  assert.equal(
    room.slots.find((slot: { start: string }) => slot.start === start)
      .available,
    true,
  );
  assert.equal((await request('/bookings', 'POST', other, body)).status, 201);
});

test('booking windows are validated against venue hours and the half-hour grid', async () => {
  const member = await signIn('alex');
  const date = '2032-06-11T';
  const payload = (start: string, end: string) => ({
    roomId,
    start: date + start + ':00.000Z',
    end: date + end + ':00.000Z',
  });
  assert.equal(
    (await request('/bookings', 'POST', member, payload('05:30', '06:30')))
      .status,
    400,
  );
  assert.equal(
    (await request('/bookings', 'POST', member, payload('08:15', '08:45')))
      .status,
    400,
  );
  assert.equal(
    (await request('/bookings', 'POST', member, payload('17:30', '18:30')))
      .status,
    400,
  );
  assert.equal(
    (await request('/bookings', 'POST', member, payload('17:30', '18:00')))
      .status,
    201,
  );
});
