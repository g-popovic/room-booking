import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { DatabaseClient } from '@room-booking/db';
import { DEMO_PASSWORD, demoTeam, seed } from '@room-booking/db/seed';

import { useTestApi } from './test-support.js';

const now = new Date('2032-06-10T06:00:00Z');
const day = 24 * 60 * 60_000;
const { db, created, call, register, signIn, newTeam, join } = useTestApi(now);

async function createMembers(count: number) {
  const rows = await db
    .insertInto('members')
    .values(
      Array.from({ length: count }, () => ({
        name: 'Team test member',
        email: `${randomUUID()}@example.test`,
      })),
    )
    .returning(['id', 'email'])
    .execute();

  created.members.push(...rows.map((row) => row.id));
  return rows;
}

async function createTeam(roles: Record<string, 'owner' | 'member'>) {
  const team = await db.transaction().execute(async (trx) => {
    const team = await trx
      .insertInto('teams')
      .values({ name: 'Test team' })
      .returning('id')
      .executeTakeFirstOrThrow();

    await trx
      .insertInto('team_members')
      .values(
        Object.entries(roles).map(([member_id, role]) => ({
          team_id: team.id,
          member_id,
          role,
        })),
      )
      .execute();

    return team.id;
  });

  created.teams.push(team);
  return team;
}

function owners(team: string) {
  return db
    .selectFrom('team_members')
    .select('member_id')
    .where('team_id', '=', team)
    .where('role', '=', 'owner')
    .orderBy('member_id')
    .execute()
    .then((rows) => rows.map((row) => row.member_id));
}

const needsOwner = { constraint: 'team_has_owner' };

const setRole = (
  trx: DatabaseClient,
  team: string,
  member: string,
  role: 'owner' | 'member',
) =>
  trx
    .updateTable('team_members')
    .set({ role })
    .where('team_id', '=', team)
    .where('member_id', '=', member)
    .execute();

test('a team can’t be created without an owner', async () => {
  const [alex] = await createMembers(1);

  await assert.rejects(
    db.transaction().execute(async (trx) => {
      const team = await trx
        .insertInto('teams')
        .values({ name: 'No owner' })
        .returning('id')
        .executeTakeFirstOrThrow();

      await trx
        .insertInto('team_members')
        .values({ team_id: team.id, member_id: alex.id, role: 'member' })
        .execute();
    }),
    needsOwner,
  );

  const team = await createTeam({ [alex.id]: 'owner' });
  assert.deepEqual(await owners(team), [alex.id]);
});

test('the last owner can’t step down or leave, but owners can hand over', async () => {
  const [alex, sam] = await createMembers(2);
  const team = await createTeam({ [alex.id]: 'owner', [sam.id]: 'member' });

  await assert.rejects(setRole(db, team, alex.id, 'member'), needsOwner);
  await assert.rejects(
    db
      .deleteFrom('team_members')
      .where('team_id', '=', team)
      .where('member_id', '=', alex.id)
      .execute(),
    needsOwner,
  );
  // Deleting the owner's account would leave the team without one too.
  await assert.rejects(
    db.deleteFrom('members').where('id', '=', alex.id).execute(),
    needsOwner,
  );

  // The check runs at commit, so the order within a transaction is free.
  await db.transaction().execute(async (trx) => {
    await setRole(trx, team, alex.id, 'member');
    await setRole(trx, team, sam.id, 'owner');
  });
  assert.deepEqual(await owners(team), [sam.id]);

  // Deleting the team removes its members along with it.
  await db.deleteFrom('teams').where('id', '=', team).execute();
  assert.equal(
    (
      await db
        .selectFrom('team_members')
        .select('member_id')
        .where('team_id', '=', team)
        .execute()
    ).length,
    0,
  );
});

test('two owners stepping down at the same moment leave one owner', async () => {
  const [alex, sam] = await createMembers(2);
  const team = await createTeam({ [alex.id]: 'owner', [sam.id]: 'owner' });

  const gate = () => {
    let open!: () => void;
    const opened = new Promise<void>((resolve) => (open = resolve));
    return { opened, open };
  };
  const release = gate();
  const steppedDown = [gate(), gate()];
  const commit = gate();

  // Hold the team's lock, as another change to its members would.
  const holder = db.transaction().execute(async (trx) => {
    await trx
      .selectFrom('teams')
      .select('id')
      .where('id', '=', team)
      .forNoKeyUpdate()
      .execute();
    await release.opened;
  });

  // Each owner steps down in their own transaction, then both commit at once.
  const results = [alex.id, sam.id].map((member, index) =>
    db.transaction().execute(async (trx) => {
      await setRole(trx, team, member, 'member');
      steppedDown[index].open();
      await commit.opened;
    }),
  );
  let settled = 0;
  for (const result of results)
    void result.then(
      () => settled++,
      () => settled++,
    );

  try {
    await Promise.all(steppedDown.map((step) => step.opened));
    commit.open();

    // Both commits wait for the team's lock. Without it, both checks would
    // see the other's owner, both would pass, and the team would have none.
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(settled, 0, 'The owner checks didn’t wait for the team.');
  } finally {
    release.open();
    await holder;
  }

  const outcomes = await Promise.allSettled(results);

  assert.deepEqual(outcomes.map((outcome) => outcome.status).sort(), [
    'fulfilled',
    'rejected',
  ]);
  const failure = outcomes.find((outcome) => outcome.status === 'rejected');
  assert.equal(
    (failure as PromiseRejectedResult).reason.constraint,
    'team_has_owner',
  );
  assert.equal((await owners(team)).length, 1);
});

test('an address can be invited again only once the last invite’s time is up', async () => {
  const [alex] = await createMembers(1);
  const team = await createTeam({ [alex.id]: 'owner' });
  const otherTeam = await createTeam({ [alex.id]: 'owner' });
  const email = `${randomUUID()}@example.test`;
  const day = 24 * 60 * 60_000;
  const start = new Date('2032-06-01T10:00:00Z');
  const at = (days: number) => new Date(start.getTime() + days * day);

  const invite = (days: number, teamId = team, address = email) =>
    db
      .insertInto('team_invites')
      .values({
        team_id: teamId,
        email: address,
        invited_by: alex.id,
        created_at: at(days),
        expires_at: at(days + 14),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
  const respond = (id: string, status: 'declined' | 'cancelled' | 'accepted') =>
    db
      .updateTable('team_invites')
      .set({ status, responded_at: at(1) })
      .where('id', '=', id)
      .execute();
  const tooSoon = { constraint: 'team_invites_one_at_a_time' };

  const first = await invite(0);
  await assert.rejects(invite(13), tooSoon);

  // Other teams and other addresses aren't affected.
  await invite(1, otherTeam);
  await invite(1, team, `${randomUUID()}@example.test`);

  // A declined invite still counts until its time is up.
  await respond(first.id, 'declined');
  await assert.rejects(invite(13), tooSoon);
  const second = await invite(14);

  // Cancelled and accepted invites don't count.
  await respond(second.id, 'cancelled');
  const third = await invite(15);
  await respond(third.id, 'accepted');
  await invite(16);

  // The response time is set exactly when an invite stops being pending.
  await assert.rejects(
    db
      .updateTable('team_invites')
      .set({ status: 'declined' })
      .where('team_id', '=', otherTeam)
      .execute(),
    { code: '23514' },
  );
});

// The rest goes through the API.

test('members create teams, and only a team’s members can see it', async () => {
  const alex = await register('Alex');
  const sam = await register('Sam');

  const made = await call(alex.cookie, 'POST', '/teams', {
    name: '  Design crew ',
  });
  assert.equal(made.status, 201);
  created.teams.push(made.body.id);
  assert.deepEqual(made.body, {
    id: made.body.id,
    name: 'Design crew',
    role: 'owner',
    memberCount: 1,
  });
  const team = made.body.id;

  const blank = await call(alex.cookie, 'POST', '/teams', { name: '  ' });
  assert.deepEqual(blank, {
    status: 400,
    body: { error: 'Enter a team name.' },
  });

  assert.deepEqual((await call(alex.cookie, 'GET', '/teams')).body, [
    made.body,
  ]);
  assert.deepEqual((await call(sam.cookie, 'GET', '/teams')).body, []);

  const details = await call(alex.cookie, 'GET', `/teams/${team}`);
  assert.equal(details.status, 200);
  assert.equal(details.body.role, 'owner');
  assert.deepEqual(details.body.members, [
    {
      id: alex.id,
      name: 'Alex',
      email: alex.email,
      role: 'owner',
      joinedAt: now.toISOString(),
    },
  ]);
  assert.deepEqual(details.body.invites, []);

  // To anyone else, the team doesn't exist, whatever they try.
  for (const [method, path, body] of [
    ['GET', `/teams/${team}`],
    ['PATCH', `/teams/${team}`, { name: 'Mine now' }],
    ['DELETE', `/teams/${team}`],
    ['POST', `/teams/${team}/invites`, { email: sam.email }],
    ['PATCH', `/teams/${team}/members/${alex.id}`, { role: 'member' }],
    ['DELETE', `/teams/${team}/members/${alex.id}`],
  ] as const) {
    assert.deepEqual(await call(sam.cookie, method, path, body), {
      status: 404,
      body: { error: 'Team not found.' },
    });
  }
  assert.equal(
    (await call(alex.cookie, 'GET', '/teams/not-a-uuid')).status,
    404,
  );
  assert.equal(
    (await call(alex.cookie, 'GET', `/teams/${randomUUID()}`)).status,
    404,
  );

  assert.equal((await call('', 'GET', '/teams')).status, 401);
  assert.equal((await call('', 'GET', '/invites')).status, 401);
});

test('owners manage a team; members can see it and leave', async () => {
  const alex = await register('Alex');
  const sam = await register('Sam');
  const team = await newTeam(alex);
  await join(alex, team, sam);

  const seen = await call(sam.cookie, 'GET', `/teams/${team}`);
  assert.equal(seen.body.role, 'member');
  assert.equal(seen.body.invites, undefined);
  assert.deepEqual(
    seen.body.members.map((member: { name: string; role: string }) => [
      member.name,
      member.role,
    ]),
    [
      ['Alex', 'owner'],
      ['Sam', 'member'],
    ],
  );

  for (const [method, path, body] of [
    ['PATCH', `/teams/${team}`, { name: 'Renamed' }],
    ['DELETE', `/teams/${team}`],
    ['POST', `/teams/${team}/invites`, { email: 'x@example.test' }],
    ['PATCH', `/teams/${team}/members/${alex.id}`, { role: 'member' }],
    ['DELETE', `/teams/${team}/members/${alex.id}`],
  ] as const) {
    assert.deepEqual(await call(sam.cookie, method, path, body), {
      status: 403,
      body: { error: 'Only team owners can do that.' },
    });
  }

  const renamed = await call(alex.cookie, 'PATCH', `/teams/${team}`, {
    name: 'Studio crew',
  });
  assert.deepEqual(renamed.body, { id: team, name: 'Studio crew' });
  assert.equal(
    (await call(sam.cookie, 'GET', '/teams')).body[0].name,
    'Studio crew',
  );

  // Handing over: make Sam an owner, then Alex steps down.
  for (const [person, role] of [
    [sam, 'owner'],
    [alex, 'member'],
  ] as const) {
    const changed = await call(
      alex.cookie,
      'PATCH',
      `/teams/${team}/members/${person.id}`,
      { role },
    );
    assert.deepEqual(changed.body, { id: person.id, role });
  }

  // Sam is now the only owner.
  const lastOwner = {
    status: 409,
    body: {
      error:
        'A team needs at least one owner. Make someone else an owner first, or delete the team.',
    },
  };
  assert.deepEqual(
    await call(sam.cookie, 'PATCH', `/teams/${team}/members/${sam.id}`, {
      role: 'member',
    }),
    lastOwner,
  );
  assert.equal(
    (
      await call(
        sam.cookie,
        'PATCH',
        `/teams/${team}/members/${randomUUID()}`,
        {
          role: 'owner',
        },
      )
    ).status,
    404,
  );

  // Alex leaves and can no longer see the team.
  assert.equal(
    (await call(alex.cookie, 'DELETE', `/teams/${team}/members/${alex.id}`))
      .status,
    204,
  );
  assert.equal((await call(alex.cookie, 'GET', `/teams/${team}`)).status, 404);

  // The last owner can't leave, but can delete the team.
  assert.deepEqual(
    await call(sam.cookie, 'DELETE', `/teams/${team}/members/${sam.id}`),
    lastOwner,
  );
  assert.equal(
    (await call(sam.cookie, 'DELETE', `/teams/${team}`)).status,
    204,
  );
  assert.equal((await call(sam.cookie, 'GET', `/teams/${team}`)).status, 404);
  assert.deepEqual((await call(sam.cookie, 'GET', '/teams')).body, []);
});

test('inviting works the same whether or not the address has an account', async () => {
  const alex = await register('Alex');
  const bob = await register('Bob');
  const carol = await register('Carol');
  const team = await newTeam(alex);
  const newcomer = `${randomUUID()}@example.test`;

  const invited = await Promise.all(
    [` ${bob.email.toUpperCase()} `, newcomer].map((email) =>
      call(alex.cookie, 'POST', `/teams/${team}/invites`, { email }),
    ),
  );
  const expiresAt = new Date(now.getTime() + 14 * day).toISOString();
  for (const [index, email] of [bob.email, newcomer].entries()) {
    assert.deepEqual(invited[index], {
      status: 201,
      body: {
        id: invited[index].body.id,
        email,
        status: 'pending',
        createdAt: now.toISOString(),
        expiresAt,
        invitedBy: 'Alex',
      },
    });
  }

  // The invitee sees it; nobody else does.
  const bobsInvites = (await call(bob.cookie, 'GET', '/invites')).body;
  assert.deepEqual(bobsInvites, [
    {
      id: invited[0].body.id,
      team: 'Design crew',
      invitedBy: 'Alex',
      createdAt: now.toISOString(),
      expiresAt,
    },
  ]);
  assert.deepEqual((await call(carol.cookie, 'GET', '/invites')).body, []);
  assert.equal(
    (await call(carol.cookie, 'POST', `/invites/${invited[0].body.id}/accept`))
      .status,
    404,
  );

  // Members and recent invitations can't be invited again.
  assert.deepEqual(
    await call(alex.cookie, 'POST', `/teams/${team}/invites`, {
      email: alex.email,
    }),
    { status: 409, body: { error: 'That person is already in this team.' } },
  );
  const again = await call(alex.cookie, 'POST', `/teams/${team}/invites`, {
    email: bob.email,
  });
  assert.equal(again.status, 409);
  assert.match(again.body.error, /already has an invitation/);

  // Bob declines. The owner sees that, and still can't invite him again
  // until the invitation's time is up.
  assert.equal(
    (await call(bob.cookie, 'POST', `/invites/${invited[0].body.id}/decline`))
      .status,
    204,
  );
  assert.deepEqual((await call(bob.cookie, 'GET', '/invites')).body, []);
  assert.equal(
    (await call(bob.cookie, 'POST', `/invites/${invited[0].body.id}/accept`))
      .status,
    404,
  );
  const listed = (await call(alex.cookie, 'GET', `/teams/${team}`)).body
    .invites;
  // Both were sent at the same moment, so compare them in a fixed order.
  assert.deepEqual(
    listed
      .map(
        (invite: { email: string; status: string }) =>
          `${invite.email} ${invite.status}`,
      )
      .sort(),
    [`${bob.email} declined`, `${newcomer} pending`].sort(),
  );
  assert.equal(
    (
      await call(alex.cookie, 'POST', `/teams/${team}/invites`, {
        email: bob.email,
      })
    ).status,
    409,
  );

  // Someone who registers with the invited address later sees the invitation.
  const dana = await register('Dana', newcomer);
  const [danasInvite] = (await call(dana.cookie, 'GET', '/invites')).body;
  assert.equal(danasInvite.id, invited[1].body.id);
  assert.deepEqual(
    await call(dana.cookie, 'POST', `/invites/${danasInvite.id}/accept`),
    { status: 200, body: { teamId: team } },
  );
  assert.deepEqual((await call(dana.cookie, 'GET', '/teams')).body, [
    { id: team, name: 'Design crew', role: 'member', memberCount: 2 },
  ]);
  assert.equal(
    (await call(dana.cookie, 'POST', `/invites/${danasInvite.id}/accept`))
      .status,
    404,
  );
});

test('owners cancel invitations, and expired ones are gone', async () => {
  const alex = await register('Alex');
  const bob = await register('Bob');
  const carol = await register('Carol');
  const team = await newTeam(alex);
  const invite = (email: string) =>
    call(alex.cookie, 'POST', `/teams/${team}/invites`, { email });

  // A cancelled invitation disappears, and the address can be invited again.
  const first = (await invite(bob.email)).body;
  assert.equal(
    (await call(alex.cookie, 'DELETE', `/teams/${team}/invites/${first.id}`))
      .status,
    204,
  );
  assert.deepEqual((await call(bob.cookie, 'GET', '/invites')).body, []);
  assert.deepEqual(
    (await call(alex.cookie, 'GET', `/teams/${team}`)).body.invites,
    [],
  );
  assert.equal(
    (await call(alex.cookie, 'DELETE', `/teams/${team}/invites/${first.id}`))
      .status,
    404,
  );
  assert.equal((await invite(bob.email)).status, 201);

  // An expired invitation can't be accepted, and the address can be invited
  // again.
  const old = (await invite(carol.email)).body;
  await db
    .updateTable('team_invites')
    .set({
      created_at: new Date(now.getTime() - 15 * day),
      expires_at: new Date(now.getTime() - day),
    })
    .where('id', '=', old.id)
    .execute();
  assert.deepEqual((await call(carol.cookie, 'GET', '/invites')).body, []);
  assert.equal(
    (await call(carol.cookie, 'POST', `/invites/${old.id}/accept`)).status,
    404,
  );
  assert.deepEqual(
    (await call(alex.cookie, 'GET', `/teams/${team}`)).body.invites.map(
      (invite: { email: string }) => invite.email,
    ),
    [bob.email],
  );
  assert.equal((await invite(carol.email)).status, 201);
});

test('a team can have at most 50 open invitations', async () => {
  const alex = await register('Alex');
  const team = await newTeam(alex);
  const invite = () =>
    call(alex.cookie, 'POST', `/teams/${team}/invites`, {
      email: `${randomUUID()}@example.test`,
    });

  let lastId = '';
  for (let count = 0; count < 50; count++) {
    const invited = await invite();
    assert.equal(invited.status, 201);
    lastId = invited.body.id;
  }
  assert.deepEqual(await invite(), {
    status: 409,
    body: {
      error:
        'This team has 50 open invitations. Cancel some before inviting more people.',
    },
  });

  await call(alex.cookie, 'DELETE', `/teams/${team}/invites/${lastId}`);
  assert.equal((await invite()).status, 201);
});

test('simultaneous changes to a team leave it consistent', async () => {
  const alex = await register('Alex');
  const sam = await register('Sam');
  const team = await newTeam(alex);
  await join(alex, team, sam);
  await call(alex.cookie, 'PATCH', `/teams/${team}/members/${sam.id}`, {
    role: 'owner',
  });

  // Two owners step down at once: one of them has to stay.
  const stepDown = await Promise.all(
    [alex, sam].map((person) =>
      call(person.cookie, 'PATCH', `/teams/${team}/members/${person.id}`, {
        role: 'member',
      }),
    ),
  );
  assert.deepEqual(stepDown.map((result) => result.status).sort(), [200, 409]);
  assert.equal((await owners(team)).length, 1);

  // The same address invited twice at once gets one invitation.
  const email = `${randomUUID()}@example.test`;
  const owner = stepDown[0].status === 200 ? sam : alex;
  const invites = await Promise.all(
    [1, 2].map(() =>
      call(owner.cookie, 'POST', `/teams/${team}/invites`, { email }),
    ),
  );
  assert.deepEqual(invites.map((result) => result.status).sort(), [201, 409]);
});

test('setup puts every demo account in one team, and can run again', async () => {
  // Setup already ran once for this file. Running it again changes nothing.
  await seed(db);

  const expected = {
    id: demoTeam.id,
    name: 'The Commons',
    memberCount: 3,
  };
  for (const [email, role] of [
    ['jamie@roomwell.test', 'owner'],
    ['alex@roomwell.test', 'member'],
    ['sam@roomwell.test', 'member'],
  ]) {
    const cookie = await signIn(email, DEMO_PASSWORD);
    const teams = (await call(cookie, 'GET', '/teams')).body;
    assert.deepEqual(
      teams.find((team: { id: string }) => team.id === demoTeam.id),
      { ...expected, role },
    );
  }
});
