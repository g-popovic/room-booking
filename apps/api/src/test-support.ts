// Shared setup for API tests that run against the test database: starts an
// API on a fixed clock, registers members through it, and removes everything
// a test file created when it finishes. Call `useTestApi` once at the top of
// a test file.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { after, before } from 'node:test';
import { createDatabase } from '@room-booking/db';
import { migrate } from '@room-booking/db/migrate';
import { seed } from '@room-booking/db/seed';

import { createApp } from './app.js';

export const TEST_PASSWORD = 'test-password';

export type TestMember = {
  id: string;
  name: string;
  email: string;
  cookie: string;
};

export function useTestApi(now: Date) {
  const url = process.env.TEST_DATABASE_URL;
  if (!url || url === process.env.DATABASE_URL) {
    throw new Error(
      'Set TEST_DATABASE_URL to a separate Postgres test database.',
    );
  }

  const db = createDatabase(url);
  // What this file created, so it can be removed afterwards.
  const created = {
    members: [] as string[],
    teams: [] as string[],
    rooms: [] as number[],
  };
  let server: Server;
  let origin = '';

  before(async () => {
    await migrate(db);
    await seed(db);
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

      const { members, teams, rooms } = created;
      if (members.length || rooms.length)
        await db
          .deleteFrom('bookings')
          .where((eb) =>
            eb.or([
              ...(members.length ? [eb('member_id', 'in', members)] : []),
              ...(rooms.length ? [eb('room_id', 'in', rooms)] : []),
            ]),
          )
          .execute();
      if (rooms.length)
        await db.deleteFrom('rooms').where('id', 'in', rooms).execute();
      // Teams before members: a team's last owner can't be deleted.
      if (teams.length)
        await db.deleteFrom('teams').where('id', 'in', teams).execute();
      if (members.length)
        await db.deleteFrom('members').where('id', 'in', members).execute();
    } finally {
      await db.destroy();
    }
  });

  // Sends a request as whoever the cookie belongs to ('' for nobody).
  async function call(
    cookie: string,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; body: any }> {
    const response = await fetch(origin + path, {
      method,
      headers: {
        Cookie: cookie,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  }

  // A path from the site root, such as a calendar feed, fetched as-is.
  const fetchPage = (path: string) =>
    fetch(origin.replace(/\/api$/, '') + path);

  async function register(
    name: string,
    email = `${randomUUID()}@example.test`,
  ): Promise<TestMember> {
    const response = await fetch(origin + '/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password: TEST_PASSWORD }),
    });
    assert.equal(response.status, 201);
    const { id } = await response.json();
    created.members.push(id);
    const cookie = response.headers.get('set-cookie')?.split(';')[0];
    assert.ok(cookie);
    return { id, name, email, cookie };
  }

  // Signs in an existing account, such as a demo one, and returns its cookie.
  async function signIn(email: string, password: string) {
    const response = await fetch(origin + '/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    assert.equal(response.status, 200);
    const cookie = response.headers.get('set-cookie')?.split(';')[0];
    assert.ok(cookie);
    return cookie;
  }

  async function newTeam(owner: TestMember, name = 'Design crew') {
    const team = await call(owner.cookie, 'POST', '/teams', { name });
    assert.equal(team.status, 201);
    created.teams.push(team.body.id);
    return team.body.id as string;
  }

  // The owner invites each person, and they accept.
  async function join(
    owner: TestMember,
    team: string,
    ...people: TestMember[]
  ) {
    for (const person of people) {
      const invite = await call(
        owner.cookie,
        'POST',
        `/teams/${team}/invites`,
        {
          email: person.email,
        },
      );
      assert.equal(invite.status, 201);
      const accepted = await call(
        person.cookie,
        'POST',
        `/invites/${invite.body.id}/accept`,
      );
      assert.equal(accepted.status, 200);
    }
  }

  async function newRoom(capacity: number) {
    const room = await db
      .insertInto('rooms')
      .values({
        name: `Test room ${randomUUID()}`,
        description: 'A fictional room for testing.',
        capacity,
        amenities: [],
      })
      .returning(['id', 'name'])
      .executeTakeFirstOrThrow();
    created.rooms.push(room.id);
    return room;
  }

  return {
    db,
    created,
    call,
    fetchPage,
    register,
    signIn,
    newTeam,
    join,
    newRoom,
  };
}
