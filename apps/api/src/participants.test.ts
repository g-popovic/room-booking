import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import ICAL from 'ical.js';

import type { TestMember } from './test-support.js';
import { useTestApi } from './test-support.js';

const now = new Date('2032-06-10T06:00:00Z');
const { db, call, fetchPage, register, newTeam, join, newRoom } =
  useTestApi(now);

// One hour from 08:00 UTC (10:00 at the venue) on the given day of July 2032.
const slot = (day: number) => ({
  start: new Date(Date.UTC(2032, 6, day, 8)).toISOString(),
  end: new Date(Date.UTC(2032, 6, day, 9)).toISOString(),
});

async function book(
  organizer: TestMember,
  roomId: number,
  day: number,
  participants: TestMember[],
) {
  return call(organizer.cookie, 'POST', '/bookings', {
    roomId,
    ...slot(day),
    participantIds: participants.map((person) => person.id),
  });
}

// The booking as this member sees it in My bookings.
async function seenBy(person: TestMember, bookingId: string) {
  const bookings = (await call(person.cookie, 'GET', '/bookings')).body;
  return bookings.find((booking: { id: string }) => booking.id === bookingId);
}

const answers = (booking: {
  participants: { name: string; response: string }[];
}) =>
  booking.participants.map((person) => `${person.name}: ${person.response}`);

test('organizers can invite people from their teams, up to the room’s seats', async () => {
  const alex = await register('Alex');
  const sam = await register('Sam');
  const carol = await register('Carol');
  const stranger = await register('Stranger');
  const team = await newTeam(alex);
  await join(alex, team, sam, carol);
  const room = await newRoom(3);

  const booked = await book(alex, room.id, 1, [sam, carol, sam]);
  assert.equal(booked.status, 201);

  const asOrganizer = await seenBy(alex, booked.body.id);
  assert.deepEqual(asOrganizer, {
    id: booked.body.id,
    room: room.name,
    capacity: 3,
    ...slot(1),
    cancelled: null,
    organizer: { id: alex.id, name: 'Alex' },
    response: 'organizer',
    participants: [
      { id: carol.id, name: 'Carol', response: 'pending' },
      { id: sam.id, name: 'Sam', response: 'pending' },
    ],
  });

  // Participants see it too, with their own answer.
  assert.deepEqual(await seenBy(sam, booked.body.id), {
    ...asOrganizer,
    response: 'pending',
  });
  assert.equal(await seenBy(stranger, booked.body.id), undefined);

  // Only teammates, not yourself, and everyone has to fit.
  const refused = [
    [[stranger], 400, 'You can only add people who are in one of your teams.'],
    [
      [{ ...stranger, id: randomUUID() }],
      400,
      'You can only add people who are in one of your teams.',
    ],
    [
      [alex],
      400,
      'You’re organizing this booking, so you don’t need to add yourself.',
    ],
  ] as const;
  for (const [people, status, error] of refused) {
    assert.deepEqual(await book(alex, room.id, 2, [...people]), {
      status,
      body: { error },
    });
  }
  const small = await newRoom(2);
  assert.deepEqual(await book(alex, small.id, 2, [sam, carol]), {
    status: 409,
    body: {
      error: `${small.name} fits 2 people, including you. Remove some people or choose a bigger room.`,
    },
  });
  assert.equal((await book(alex, small.id, 2, [sam])).status, 201);
});

test('participants answer, and only the organizer can cancel', async () => {
  const alex = await register('Alex');
  const sam = await register('Sam');
  const stranger = await register('Stranger');
  const team = await newTeam(alex);
  await join(alex, team, sam);
  const room = await newRoom(4);
  const { id } = (await book(alex, room.id, 3, [sam])).body;
  const answer = (person: TestMember, response: string) =>
    call(person.cookie, 'PUT', `/bookings/${id}/response`, { response });

  assert.deepEqual(await answer(sam, 'attending'), {
    status: 200,
    body: { response: 'attending' },
  });
  assert.deepEqual(answers(await seenBy(alex, id)), ['Sam: attending']);

  // Answers can change.
  assert.equal((await answer(sam, 'not_attending')).status, 200);
  assert.equal((await seenBy(sam, id)).response, 'not_attending');
  assert.equal((await answer(sam, 'maybe')).status, 400);

  assert.deepEqual(await answer(alex, 'not_attending'), {
    status: 403,
    body: {
      error: 'You’re organizing this booking, so you’re always attending.',
    },
  });
  assert.equal((await answer(stranger, 'attending')).status, 404);

  assert.deepEqual(await call(sam.cookie, 'DELETE', `/bookings/${id}`), {
    status: 403,
    body: {
      error:
        'Only the organizer can cancel this booking. You can say you’re not attending instead.',
    },
  });
  assert.equal(
    (await call(stranger.cookie, 'DELETE', `/bookings/${id}`)).status,
    404,
  );
  assert.equal(
    (await call(alex.cookie, 'DELETE', `/bookings/${id}`)).status,
    204,
  );

  // Everyone sees the cancellation, and nobody can answer any more.
  assert.equal((await seenBy(sam, id)).cancelled, now.toISOString());
  assert.deepEqual(await answer(sam, 'attending'), {
    status: 409,
    body: { error: 'This booking was cancelled.' },
  });
});

test('the organizer changes who’s invited until the booking starts', async () => {
  const alex = await register('Alex');
  const sam = await register('Sam');
  const carol = await register('Carol');
  const stranger = await register('Stranger');
  const team = await newTeam(alex);
  await join(alex, team, sam, carol);
  const room = await newRoom(3);
  const { id } = (await book(alex, room.id, 4, [sam])).body;
  const invite = (person: TestMember, people: TestMember[]) =>
    call(person.cookie, 'PUT', `/bookings/${id}/participants`, {
      participantIds: people.map((member) => member.id),
    });

  await call(sam.cookie, 'PUT', `/bookings/${id}/response`, {
    response: 'attending',
  });

  // People who stay keep their answers.
  const changed = await invite(alex, [sam, carol]);
  assert.deepEqual(changed, {
    status: 200,
    body: [
      { id: carol.id, name: 'Carol', response: 'pending' },
      { id: sam.id, name: 'Sam', response: 'attending' },
    ],
  });

  assert.equal((await invite(alex, [sam, carol, stranger])).status, 400);
  assert.equal((await invite(alex, [sam, carol, alex])).status, 400);
  assert.deepEqual(await invite(sam, [sam]), {
    status: 403,
    body: { error: 'Only the organizer can change who’s invited.' },
  });

  // Someone who left the team stays invited, but can't be added again.
  await call(sam.cookie, 'DELETE', `/teams/${team}/members/${sam.id}`);
  assert.equal((await invite(alex, [sam])).status, 200);
  assert.equal((await invite(alex, [])).status, 200);
  assert.equal(await seenBy(sam, id), undefined);
  assert.equal(
    (
      await call(sam.cookie, 'PUT', `/bookings/${id}/response`, {
        response: 'attending',
      })
    ).status,
    404,
  );
  assert.equal((await invite(alex, [sam])).status, 400);

  // Nothing changes once it has started.
  const started = await db
    .insertInto('bookings')
    .values({
      member_id: alex.id,
      room_id: room.id,
      starts_at: new Date(now.getTime() - 30 * 60_000),
      ends_at: new Date(now.getTime() + 30 * 60_000),
      cancelled_at: null,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await db
    .insertInto('booking_participants')
    .values({ booking_id: started.id, member_id: carol.id })
    .execute();
  const tooLate = {
    status: 409,
    body: { error: 'This booking has already started.' },
  };
  assert.deepEqual(
    await call(alex.cookie, 'PUT', `/bookings/${started.id}/participants`, {
      participantIds: [],
    }),
    tooLate,
  );
  assert.deepEqual(
    await call(carol.cookie, 'PUT', `/bookings/${started.id}/response`, {
      response: 'attending',
    }),
    tooLate,
  );
});

test('participants’ calendars show the booking unless they said no', async () => {
  const alex = await register('Alex');
  const sam = await register('Sam');
  const team = await newTeam(alex);
  await join(alex, team, sam);
  const room = await newRoom(2);
  const { id } = (await book(alex, room.id, 5, [sam])).body;
  const { path } = (await call(sam.cookie, 'POST', '/calendar-feed')).body;

  const uids = async () => {
    const response = await fetchPage(path);
    assert.equal(response.status, 200);
    return new ICAL.Component(ICAL.parse(await response.text()))
      .getAllSubcomponents('vevent')
      .map((event) => [
        event.getFirstPropertyValue('uid'),
        event.getFirstPropertyValue('description'),
      ]);
  };

  assert.deepEqual(await uids(), [
    [
      `${id}@roomwell`,
      'Alex invited you to this meeting room booking on Roomwell. To answer, use My bookings in Roomwell.',
    ],
  ]);

  await call(sam.cookie, 'PUT', `/bookings/${id}/response`, {
    response: 'not_attending',
  });
  assert.deepEqual(await uids(), []);

  await call(sam.cookie, 'PUT', `/bookings/${id}/response`, {
    response: 'attending',
  });
  assert.equal((await uids()).length, 1);
});

test('an organizer can’t be stored as a participant of their own booking', async () => {
  const alex = await register('Alex');
  const room = await newRoom(2);
  const { id } = (await book(alex, room.id, 6, [])).body;

  await assert.rejects(
    db
      .insertInto('booking_participants')
      .values({ booking_id: id, member_id: alex.id })
      .execute(),
    { constraint: 'participant_is_not_organizer' },
  );
});

test('teammates lists everyone who shares a team, once', async () => {
  const alex = await register('Alex');
  const sam = await register('Sam');
  const carol = await register('Carol');
  const loner = await register('Loner');
  const first = await newTeam(alex, 'First');
  const second = await newTeam(alex, 'Second');
  await join(alex, first, sam);
  await join(alex, second, sam, carol);

  assert.deepEqual((await call(alex.cookie, 'GET', '/teammates')).body, {
    people: [
      { id: carol.id, name: 'Carol', email: carol.email },
      { id: sam.id, name: 'Sam', email: sam.email },
    ],
    teams: [
      { id: first, name: 'First', memberIds: [sam.id] },
      { id: second, name: 'Second', memberIds: [carol.id, sam.id] },
    ],
  });
  assert.deepEqual((await call(loner.cookie, 'GET', '/teammates')).body, {
    people: [],
    teams: [],
  });
  assert.equal((await call('', 'GET', '/teammates')).status, 401);
});
