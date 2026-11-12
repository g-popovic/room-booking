import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { after, before, test } from 'node:test';
import { createDatabase } from '@room-booking/db';
import ICAL from 'ical.js';
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

// Check the connection once up front, so a stopped server or missing database
// gives one clear message instead of the same error from every test.
try {
  await db.introspection.getSchemas();
} catch (error) {
  await db.destroy();
  const { host, pathname } = new URL(url);
  throw new Error(
    `Can't reach the test database ${pathname.slice(1)} on ${host}: ` +
      `${(error as Error).message}. Start PostgreSQL and create the ` +
      'database first. On Debian or Ubuntu, run pnpm db:start.',
    { cause: error },
  );
}
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

test('a private calendar feed lists only the member’s active bookings', async () => {
  const id = randomUUID();
  await db.insertInto('members').values({ id, name: 'Feed member' }).execute();

  const insert = (start: string, end: string, cancelled = false) =>
    db
      .insertInto('bookings')
      .values({
        member_id: id,
        room_id: roomId,
        starts_at: new Date(start),
        ends_at: new Date(end),
        cancelled_at: cancelled ? now : null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

  try {
    for (const method of ['GET', 'POST', 'DELETE']) {
      assert.equal((await request('/calendar-feed', method)).status, 401);
    }

    const upcoming = await insert(
      '2032-07-01T08:00:00.000Z',
      '2032-07-01T09:30:00.000Z',
    );
    const recent = await insert(
      '2031-12-01T10:00:00.000Z',
      '2031-12-01T11:00:00.000Z',
    );
    await insert('2032-07-02T08:00:00.000Z', '2032-07-02T09:00:00.000Z', true);
    // History reaches back 12 months from now (2031-06-10T06:00Z): a booking
    // ending exactly then is still listed, one ending earlier is not.
    const edge = await insert(
      '2031-06-10T05:00:00.000Z',
      '2031-06-10T06:00:00.000Z',
    );
    await insert('2031-06-10T04:00:00.000Z', '2031-06-10T05:00:00.000Z');

    const cookie = await signIn(id);
    const feed = (path: string) => fetch(origin.replace(/\/api$/, '') + path);

    assert.equal(
      await (await request('/calendar-feed', 'GET', cookie)).json(),
      null,
    );

    const created = await request('/calendar-feed', 'POST', cookie);
    assert.equal(created.status, 201);
    const { path, createdAt } = await created.json();
    assert.match(path, /^\/api\/calendar\/[A-Za-z0-9_-]{43}\.ics$/);
    assert.equal(createdAt, now.toISOString());

    const status = await request('/calendar-feed', 'GET', cookie);
    assert.deepEqual(await status.json(), { createdAt: now.toISOString() });

    const token = path.slice('/api/calendar/'.length, -'.ics'.length);
    const stored = await db
      .selectFrom('calendar_feeds')
      .select('token_hash')
      .where('member_id', '=', id)
      .executeTakeFirstOrThrow();
    assert.deepEqual(
      stored.token_hash,
      createHash('sha256').update(token).digest(),
    );

    // Calendar servers fetch the feed without the session cookie.
    const response = await feed(path);
    assert.equal(response.status, 200);
    assert.match(
      response.headers.get('content-type') ?? '',
      /^text\/calendar; charset=utf-8/,
    );
    assert.equal(response.headers.get('cache-control'), 'no-store');

    const calendar = new ICAL.Component(ICAL.parse(await response.text()));
    const events = calendar
      .getAllSubcomponents('vevent')
      .map((vevent) => new ICAL.Event(vevent));

    assert.deepEqual(
      events.map((event) => event.uid),
      [
        `${edge.id}@roomwell`,
        `${recent.id}@roomwell`,
        `${upcoming.id}@roomwell`,
      ],
    );
    assert.equal(events[2].summary, `${details.name} · Roomwell`);
    assert.equal(events[2].location, 'The Commons, Podgorica');
    assert.equal(
      events[2].startDate.toJSDate().toISOString(),
      '2032-07-01T08:00:00.000Z',
    );
    assert.equal(
      events[2].endDate.toJSDate().toISOString(),
      '2032-07-01T09:30:00.000Z',
    );

    // Titles use the room's current name, so renames reach the calendar.
    await db
      .updateTable('rooms')
      .set({ name: `${details.name} renamed` })
      .where('id', '=', roomId)
      .execute();
    const renamed = new ICAL.Component(
      ICAL.parse(await (await feed(path)).text()),
    );
    assert.equal(
      renamed.getFirstSubcomponent('vevent')?.getFirstPropertyValue('summary'),
      `${details.name} renamed · Roomwell`,
    );

    // Cancelling a booking removes it from the next refresh.
    assert.equal(
      (await request(`/bookings/${upcoming.id}`, 'DELETE', cookie)).status,
      204,
    );
    const refreshed = new ICAL.Component(
      ICAL.parse(await (await feed(path)).text()),
    );
    assert.deepEqual(
      refreshed
        .getAllSubcomponents('vevent')
        .map((vevent) => vevent.getFirstPropertyValue('uid')),
      [`${edge.id}@roomwell`, `${recent.id}@roomwell`],
    );

    // Replacing the link makes the old one stop working immediately.
    const replaced = await (
      await request('/calendar-feed', 'POST', cookie)
    ).json();
    assert.notEqual(replaced.path, path);
    assert.equal((await feed(path)).status, 404);
    assert.equal((await feed(replaced.path)).status, 200);

    assert.equal(
      (await feed('/api/calendar/not-a-real-token.ics')).status,
      404,
    );
    assert.equal(
      (await feed(`/api/calendar/${'A'.repeat(43)}.ics`)).status,
      404,
    );

    assert.equal(
      (await request('/calendar-feed', 'DELETE', cookie)).status,
      204,
    );
    assert.equal((await feed(replaced.path)).status, 404);
    assert.equal(
      await (await request('/calendar-feed', 'GET', cookie)).json(),
      null,
    );
  } finally {
    await db
      .updateTable('rooms')
      .set({ name: details.name })
      .where('id', '=', roomId)
      .execute();
    await db.deleteFrom('bookings').where('member_id', '=', id).execute();
    await db.deleteFrom('members').where('id', '=', id).execute();
  }
});

test('each calendar link shows only its own member’s bookings', async () => {
  const members = [randomUUID(), randomUUID()];
  await db
    .insertInto('members')
    .values(members.map((id) => ({ id, name: 'Feed member' })))
    .execute();

  try {
    const bookings = await Promise.all(
      members.map((id, index) =>
        db
          .insertInto('bookings')
          .values({
            member_id: id,
            room_id: roomId,
            starts_at: new Date(`2032-08-0${index + 1}T08:00:00.000Z`),
            ends_at: new Date(`2032-08-0${index + 1}T09:00:00.000Z`),
            cancelled_at: null,
          })
          .returning('id')
          .executeTakeFirstOrThrow(),
      ),
    );
    const cookies = await Promise.all(members.map(signIn));
    const createLink = async (cookie: string) =>
      (await (await request('/calendar-feed', 'POST', cookie)).json())
        .path as string;
    const uids = async (path: string) => {
      const response = await fetch(origin.replace(/\/api$/, '') + path);
      assert.equal(response.status, 200);
      return new ICAL.Component(ICAL.parse(await response.text()))
        .getAllSubcomponents('vevent')
        .map((vevent) => vevent.getFirstPropertyValue('uid'));
    };

    const [first, second] = await Promise.all(cookies.map(createLink));
    assert.deepEqual(await uids(first), [`${bookings[0].id}@roomwell`]);
    assert.deepEqual(await uids(second), [`${bookings[1].id}@roomwell`]);

    // Replacing or turning off one member's link leaves the other's alone.
    const replaced = await createLink(cookies[0]);
    assert.deepEqual(await uids(second), [`${bookings[1].id}@roomwell`]);
    assert.equal(
      (await request('/calendar-feed', 'DELETE', cookies[1])).status,
      204,
    );
    assert.deepEqual(await uids(replaced), [`${bookings[0].id}@roomwell`]);
  } finally {
    await db.deleteFrom('bookings').where('member_id', 'in', members).execute();
    await db.deleteFrom('members').where('id', 'in', members).execute();
  }
});
