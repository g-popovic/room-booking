import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { Server } from 'node:http';
import type { Express } from 'express';
import { after, before, test } from 'node:test';
import { createDatabase } from '@room-booking/db';
import ICAL from 'ical.js';
import { migrate } from '@room-booking/db/migrate';
import { DEMO_PASSWORD, seed } from '@room-booking/db/seed';
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

function sessionCookie(response: Response) {
  const cookie = response.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie);
  return cookie;
}

async function signIn(email: string, password = DEMO_PASSWORD) {
  const response = await request('/auth/login', 'POST', '', {
    email,
    password,
  });
  assert.equal(response.status, 200);
  return sessionCookie(response);
}

const TEST_PASSWORD = 'test-password';

// Starts another API on the same database. `configure` can change Express
// settings before it starts listening. The rate limiters are created once in
// the auth module, so every app in this process shares their counts. Tests
// keep their counts apart with their own emails and client addresses.
async function startApp(configure?: (app: Express) => void) {
  const app = createApp(db, () => now);
  configure?.(app);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');

  return {
    origin: `http://127.0.0.1:${address.port}/api`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

// For the rate-limit tests: an API that takes the client address from
// X-Forwarded-For, so each test can act as several clients. No other test
// registers from the 203.0.113.x addresses they use.
const startAppWithAddresses = () =>
  startApp((app) => app.set('trust proxy', 'loopback'));

function post(base: string, path: string, body: unknown, address?: string) {
  return fetch(base + path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(address ? { 'X-Forwarded-For': address } : {}),
    },
    body: JSON.stringify(body),
  });
}

// Registers a new member through the API. Callers delete it afterwards.
async function register(name = 'Test member') {
  const email = `${randomUUID()}@example.test`;
  const response = await request('/auth/register', 'POST', '', {
    name,
    email,
    password: TEST_PASSWORD,
  });
  assert.equal(response.status, 201);
  const { id } = (await response.json()) as { id: string };
  return { id, email, cookie: sessionCookie(response) };
}

test('room permissions follow the stored admin flag for an existing session', async () => {
  const updated = { ...details, capacity: 5 };
  const { id, cookie } = await register();

  try {
    assert.equal(
      (await request(`/rooms/${roomId}`, 'PUT', cookie, updated)).status,
      403,
    );

    await db
      .updateTable('members')
      .set({ is_admin: true })
      .where('id', '=', id)
      .execute();

    const session = await request('/auth/me', 'GET', cookie);
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
  const alex = await signIn('alex@roomwell.test');
  const sam = await signIn('sam@roomwell.test');
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

test('bookings for one room are saved one at a time', async () => {
  // Simultaneous requests for the same time used to make PostgreSQL's
  // no-overlap check wait in a cycle, and it cancelled them with a deadlock
  // error (a 500) instead of the overlap error. Locking the room while saving
  // a booking prevents that. This test holds the room's lock, as another
  // booking being saved would, and checks that a request waits for it.
  const alex = await signIn('alex@roomwell.test');
  const body = {
    roomId,
    start: '2032-09-01T08:00:00.000Z',
    end: '2032-09-01T09:00:00.000Z',
  };

  const pending = await db.transaction().execute(async (trx) => {
    await trx
      .selectFrom('rooms')
      .select('id')
      .where('id', '=', roomId)
      .forNoKeyUpdate()
      .execute();

    const response = request('/bookings', 'POST', alex, body);
    let finished = false;
    void response.finally(() => (finished = true));

    // Without the lock, the request would have booked the slot by now.
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(finished, false, 'The request didn’t wait for the room.');

    // Another member's overlapping booking is saved first.
    await trx
      .insertInto('bookings')
      .values({
        member_id: 'sam',
        room_id: roomId,
        starts_at: new Date('2032-09-01T08:30:00.000Z'),
        ends_at: new Date('2032-09-01T09:30:00.000Z'),
        cancelled_at: null,
      })
      .execute();

    // Returned in an object so the transaction commits without waiting for
    // the request, which is waiting for the transaction.
    return { response };
  });

  const response = await pending.response;
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /no longer available/);
});

test('booking windows are validated against venue hours and the half-hour grid', async () => {
  const member = await signIn('alex@roomwell.test');
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
  const { id, cookie } = await register('Feed member');

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
  const accounts = await Promise.all([
    register('Feed member'),
    register('Feed member'),
  ]);
  const members = accounts.map((account) => account.id);
  const cookies = accounts.map((account) => account.cookie);

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

test('registering creates a signed-in member with a hashed password', async () => {
  const email = `${randomUUID()}@Example.TEST`;
  const response = await request('/auth/register', 'POST', '', {
    name: '  New member ',
    email: `  ${email} `,
    password: TEST_PASSWORD,
    // Registration ignores any attempt to become an admin.
    isAdmin: true,
    is_admin: true,
  });
  assert.equal(response.status, 201);
  const account = await response.json();

  try {
    assert.deepEqual(account, {
      id: account.id,
      name: 'New member',
      email: email.toLowerCase(),
      isAdmin: false,
    });

    const cookie = sessionCookie(response);
    const me = await request('/auth/me', 'GET', cookie);
    assert.deepEqual(await me.json(), { account });

    const stored = await db
      .selectFrom('members')
      .select(['email', 'password_hash', 'is_admin'])
      .where('id', '=', account.id)
      .executeTakeFirstOrThrow();
    assert.equal(stored.email, email.toLowerCase());
    assert.equal(stored.is_admin, false);
    assert.match(stored.password_hash ?? '', /^scrypt\$/);
    assert.ok(!stored.password_hash?.includes(TEST_PASSWORD));

    // The same address in a different case is the same account.
    const duplicate = await request('/auth/register', 'POST', '', {
      name: 'Someone else',
      email: email.toUpperCase(),
      password: 'another-password',
    });
    assert.equal(duplicate.status, 409);
    assert.match((await duplicate.json()).error, /already exists/);
  } finally {
    await db.deleteFrom('members').where('id', '=', account.id).execute();
  }
});

test('registration explains which field needs fixing', async () => {
  const valid = {
    name: 'Test member',
    email: `${randomUUID()}@example.test`,
    password: TEST_PASSWORD,
  };
  const cases: [Record<string, unknown>, RegExp][] = [
    [{ ...valid, name: '   ' }, /name/],
    [{ ...valid, email: 'not-an-email' }, /email/],
    [{ ...valid, password: 'short' }, /at least 8 characters/],
    [{ ...valid, password: 'x'.repeat(129) }, /128 characters or fewer/],
    [{ name: 'Test member' }, /.+/],
  ];

  for (const [body, message] of cases) {
    const response = await request('/auth/register', 'POST', '', body);
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, message);
  }

  assert.equal(
    await db
      .selectFrom('members')
      .select('id')
      .where('email', '=', valid.email)
      .executeTakeFirst(),
    undefined,
  );
});

test('signing in checks the password and replaces the browser’s session', async () => {
  const { id, email, cookie: registered } = await register();

  try {
    const wrongPassword = await request('/auth/login', 'POST', '', {
      email,
      password: 'wrong-password',
    });
    const unknownEmail = await request('/auth/login', 'POST', '', {
      email: `${randomUUID()}@example.test`,
      password: TEST_PASSWORD,
    });
    assert.equal(wrongPassword.status, 401);
    assert.equal(unknownEmail.status, 401);
    // Both failures look the same, so they don't reveal who has an account.
    assert.deepEqual(await wrongPassword.json(), await unknownEmail.json());
    assert.equal(wrongPassword.headers.get('set-cookie'), null);

    assert.equal(
      (await request('/auth/login', 'POST', '', { email })).status,
      400,
    );

    // Emails match regardless of case and surrounding spaces.
    const response = await request('/auth/login', 'POST', registered, {
      email: ` ${email.toUpperCase()} `,
      password: TEST_PASSWORD,
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).id, id);
    const cookie = sessionCookie(response);
    assert.notEqual(cookie, registered);

    // The browser's previous session ends when it signs in again.
    assert.equal((await request('/bookings', 'GET', registered)).status, 401);
    assert.equal((await request('/bookings', 'GET', cookie)).status, 200);

    // A member without a password can't sign in.
    await db
      .updateTable('members')
      .set({ password_hash: null })
      .where('id', '=', id)
      .execute();
    assert.equal(
      (
        await request('/auth/login', 'POST', '', {
          email,
          password: TEST_PASSWORD,
        })
      ).status,
      401,
    );
  } finally {
    await db.deleteFrom('members').where('id', '=', id).execute();
  }
});

test('demo accounts sign in with the demo password', async () => {
  const cookie = await signIn('jamie@roomwell.test');
  const me = await (await request('/auth/me', 'GET', cookie)).json();
  assert.deepEqual(me.account, {
    id: 'operator',
    name: 'Jamie Lee',
    email: 'jamie@roomwell.test',
    isAdmin: true,
  });
});

test('sessions are stored hashed, survive a restart, and end on sign-out or expiry', async () => {
  const { id, email, cookie } = await register();
  const token = cookie.split('=')[1];

  try {
    const rows = await db
      .selectFrom('sessions')
      .select(['token_hash', 'expires_at'])
      .where('member_id', '=', id)
      .execute();
    assert.equal(rows.length, 1);
    assert.deepEqual(
      rows[0].token_hash,
      createHash('sha256').update(token).digest(),
    );
    assert.equal(
      rows[0].expires_at.getTime(),
      now.getTime() + 14 * 24 * 60 * 60_000,
    );

    // A second API process using the same database accepts the session.
    const restarted = await startApp();
    try {
      const me = await fetch(`${restarted.origin}/auth/me`, {
        headers: { Cookie: cookie },
      });
      assert.equal((await me.json()).account.id, id);
    } finally {
      await restarted.close();
    }

    // Unknown and malformed tokens are treated as signed out.
    for (const other of [
      `roomwell_session=${'A'.repeat(43)}`,
      'roomwell_session=not-a-token',
    ]) {
      assert.equal(
        (await (await request('/auth/me', 'GET', other)).json()).account,
        null,
      );
      assert.equal((await request('/bookings', 'GET', other)).status, 401);
    }

    // Signing out deletes the session, so a copy of the cookie stops working.
    const logout = await request('/auth/logout', 'POST', cookie);
    assert.equal(logout.status, 204);
    assert.match(logout.headers.get('set-cookie') ?? '', /roomwell_session=;/);
    assert.equal((await request('/bookings', 'GET', cookie)).status, 401);
    assert.equal(
      (await (await request('/auth/me', 'GET', cookie)).json()).account,
      null,
    );
    assert.equal(
      (
        await db
          .selectFrom('sessions')
          .select('member_id')
          .where('member_id', '=', id)
          .execute()
      ).length,
      0,
    );

    // Signing out without a session is harmless.
    assert.equal((await request('/auth/logout', 'POST')).status, 204);

    // Expired sessions are refused, then cleared on the next sign-in.
    const fresh = await signIn(email, TEST_PASSWORD);
    await db
      .updateTable('sessions')
      .set({ expires_at: now })
      .where('member_id', '=', id)
      .execute();
    assert.equal((await request('/bookings', 'GET', fresh)).status, 401);
    assert.equal(
      (await request('/rooms/1', 'PUT', fresh, details)).status,
      401,
    );

    await signIn(email, TEST_PASSWORD);
    const remaining = await db
      .selectFrom('sessions')
      .select('expires_at')
      .where('member_id', '=', id)
      .execute();
    assert.equal(remaining.length, 1);
    assert.ok(remaining[0].expires_at > now);
  } finally {
    await db.deleteFrom('members').where('id', '=', id).execute();
  }
});

test('repeated wrong passwords for an email are refused for a while', async () => {
  const { id, email } = await register();
  const other = await register();
  const api = await startAppWithAddresses();
  const attempt = (address: string, password: string, from = '203.0.113.1') =>
    post(api.origin, '/auth/login', { email: address, password }, from);

  try {
    // Incomplete requests aren't wrong passwords, so they don't count.
    for (let count = 0; count < 12; count++) {
      assert.equal((await attempt(email, '')).status, 400);
    }

    for (let count = 0; count < 10; count++) {
      assert.equal((await attempt(email, 'wrong-password')).status, 401);
    }

    // Even the right password is refused until the window passes, and the
    // email's case doesn't get around it.
    const blocked = await attempt(email.toUpperCase(), TEST_PASSWORD);
    assert.equal(blocked.status, 429);
    assert.match((await blocked.json()).error, /Too many failed attempts/);
    assert.ok(Number(blocked.headers.get('retry-after')) > 0);
    assert.equal(blocked.headers.get('set-cookie'), null);

    // Other accounts from the same address aren't affected, and nor is this
    // account from another address.
    assert.equal((await attempt(other.email, TEST_PASSWORD)).status, 200);
    assert.equal(
      (await attempt(email, TEST_PASSWORD, '203.0.113.2')).status,
      200,
    );
  } finally {
    await api.close();
    await db.deleteFrom('members').where('id', 'in', [id, other.id]).execute();
  }
});

test('repeatedly registering taken emails is refused for a while', async () => {
  const taken = await register();
  const created = [taken.id];
  const api = await startAppWithAddresses();
  const attempt = async (
    email: string,
    password = TEST_PASSWORD,
    from = '203.0.113.1',
  ) => {
    const response = await post(
      api.origin,
      '/auth/register',
      { name: 'Test member', email, password },
      from,
    );
    if (response.status === 201) created.push((await response.json()).id);
    return response.status;
  };
  const newEmail = () => `${randomUUID()}@example.test`;

  try {
    // Successful sign-ups and invalid forms don't count.
    for (let count = 0; count < 11; count++) {
      assert.equal(await attempt(newEmail()), 201);
      assert.equal(await attempt(newEmail(), 'short'), 400);
    }

    for (let count = 0; count < 10; count++) {
      assert.equal(await attempt(taken.email), 409);
    }

    // Now even a new email is refused from this address.
    const email = newEmail();
    assert.equal(await attempt(email), 429);
    assert.equal(
      await db
        .selectFrom('members')
        .select('id')
        .where('email', '=', email)
        .executeTakeFirst(),
      undefined,
    );

    // Other addresses can still register.
    assert.equal(await attempt(newEmail(), TEST_PASSWORD, '203.0.113.2'), 201);
  } finally {
    await api.close();
    await db.deleteFrom('members').where('id', 'in', created).execute();
  }
});
