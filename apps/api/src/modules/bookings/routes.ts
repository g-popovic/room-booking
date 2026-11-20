import type { DatabaseClient } from '@room-booking/db';
import { Router } from 'express';
import { z } from 'zod';

import type { MemberResponse } from '../../app-locals.js';
import { HttpError } from '../../http-error.js';
import { requireMember } from '../../middleware/auth.js';
import { validBookingWindow } from './schedule.js';

const router = Router();

router.use(requireMember);

const people = z
  .array(z.string().min(1).max(100))
  .max(100)
  .transform((ids) => [...new Set(ids)]);

const bookingInput = z.object({
  roomId: z.number().int().positive(),
  start: z.iso.datetime().transform((value) => new Date(value)),
  end: z.iso.datetime().transform((value) => new Date(value)),
  participantIds: people.default([]),
});
const participantsInput = z.object({ participantIds: people });
const responseInput = z.object({
  response: z.enum(['attending', 'not_attending']),
});

const bookingNotFound = 'Booking not found.';

// Checks a list of people someone wants to invite to a booking in a room.
// Only people who are new to the booking must share a team with the
// organizer, so someone who has since left the team can stay on it. Everyone
// invited counts against the room's seats, whatever they answered, because
// answers can change.
async function checkParticipants(
  db: DatabaseClient,
  organizerId: string,
  room: { name: string; capacity: number },
  participantIds: string[],
  alreadyInvited: string[] = [],
) {
  if (participantIds.includes(organizerId))
    throw new HttpError(
      400,
      'You’re organizing this booking, so you don’t need to add yourself.',
    );

  const added = participantIds.filter((id) => !alreadyInvited.includes(id));
  const teammates = added.length
    ? await db
        .selectFrom('team_members as theirs')
        .innerJoin('team_members as mine', 'mine.team_id', 'theirs.team_id')
        .select('theirs.member_id')
        .distinct()
        .where('mine.member_id', '=', organizerId)
        .where('theirs.member_id', 'in', added)
        .execute()
    : [];

  if (teammates.length !== added.length)
    throw new HttpError(
      400,
      'You can only add people who are in one of your teams.',
    );

  if (participantIds.length + 1 > room.capacity)
    throw new HttpError(
      409,
      `${room.name} fits ${room.capacity} ${room.capacity === 1 ? 'person' : 'people'}, including you. Remove some people or choose a bigger room.`,
    );
}

// Finds a booking the member organizes or is invited to. To anyone else it
// doesn't exist. With `lock`, inside a transaction, changes to the booking
// wait until that transaction ends.
async function findBooking(
  db: DatabaseClient,
  id: string,
  memberId: string,
  lock = false,
) {
  if (!z.uuid().safeParse(id).success)
    throw new HttpError(404, bookingNotFound);

  const query = db
    .selectFrom('bookings')
    .innerJoin('rooms', 'rooms.id', 'bookings.room_id')
    .leftJoin('booking_participants as me', (join) =>
      join
        .onRef('me.booking_id', '=', 'bookings.id')
        .on('me.member_id', '=', memberId),
    )
    .select([
      'bookings.member_id as organizerId',
      'bookings.starts_at',
      'bookings.cancelled_at',
      'rooms.name as room',
      'rooms.capacity',
      'me.member_id as participantId',
    ])
    .where('bookings.id', '=', id);

  const booking = await (
    lock ? query.forNoKeyUpdate('bookings') : query
  ).executeTakeFirst();

  if (!booking) throw new HttpError(404, bookingNotFound);

  const organizer = booking.organizerId === memberId;
  if (!organizer && !booking.participantId)
    throw new HttpError(404, bookingNotFound);

  return { ...booking, organizer };
}

// Changes are only possible while a booking is still ahead.
function assertUpcoming(
  booking: { starts_at: Date; cancelled_at: Date | null },
  now: Date,
) {
  if (booking.cancelled_at)
    throw new HttpError(409, 'This booking was cancelled.');
  if (booking.starts_at <= now)
    throw new HttpError(409, 'This booking has already started.');
}

function participantsOf(db: DatabaseClient, bookingIds: string[]) {
  if (!bookingIds.length) return Promise.resolve([]);

  return db
    .selectFrom('booking_participants')
    .innerJoin('members', 'members.id', 'booking_participants.member_id')
    .select([
      'booking_participants.booking_id as bookingId',
      'members.id',
      'members.name',
      'booking_participants.response',
    ])
    .where('booking_participants.booking_id', 'in', bookingIds)
    .orderBy('members.name')
    .execute();
}

// Bookings the member organizes or is invited to. Participants see each
// other's names but not emails, because they may not share a team.
router.get('/', async (_req, res: MemberResponse) => {
  const { db, member } = res.locals;

  const bookings = await db
    .selectFrom('bookings')
    .innerJoin('rooms', 'rooms.id', 'bookings.room_id')
    .innerJoin('members as organizer', 'organizer.id', 'bookings.member_id')
    .leftJoin('booking_participants as me', (join) =>
      join
        .onRef('me.booking_id', '=', 'bookings.id')
        .on('me.member_id', '=', member.id),
    )
    .select([
      'bookings.id',
      'rooms.name as room',
      'rooms.capacity',
      'bookings.starts_at as start',
      'bookings.ends_at as end',
      'bookings.cancelled_at as cancelled',
      'organizer.id as organizerId',
      'organizer.name as organizerName',
      'me.response as myResponse',
    ])
    .where((eb) =>
      eb.or([
        eb('bookings.member_id', '=', member.id),
        eb('me.member_id', 'is not', null),
      ]),
    )
    .orderBy('bookings.starts_at', 'desc')
    .execute();

  const participants = await participantsOf(
    db,
    bookings.map((booking) => booking.id),
  );

  res.json(
    bookings.map(({ organizerId, organizerName, myResponse, ...booking }) => ({
      ...booking,
      organizer: { id: organizerId, name: organizerName },
      // The organizer is always attending and isn't asked.
      response: myResponse ?? 'organizer',
      participants: participants
        .filter((participant) => participant.bookingId === booking.id)
        .map(({ bookingId: _, ...participant }) => participant),
    })),
  );
});

router.post('/', async (req, res: MemberResponse) => {
  const { db, clock, member } = res.locals;

  const { roomId, start, end, participantIds } = bookingInput.parse(req.body);
  if (!validBookingWindow(start, end, clock())) {
    return res.status(400).json({
      error:
        'Choose a future time between 08:00 and 20:00 in 30-minute increments.',
    });
  }

  // Bookings for one room are saved one at a time, by locking the room's row
  // until this transaction ends. Without the lock, PostgreSQL's no-overlap
  // check makes requests for the same time that arrive together wait for each
  // other, and it cancels all but one with a deadlock error instead of the
  // overlap error. With it, a later request waits for the earlier one to
  // finish, then sees its booking and fails the overlap check (409).
  const booking = await db.transaction().execute(async (trx) => {
    const room = await trx
      .selectFrom('rooms')
      .select(['id', 'name', 'capacity'])
      .where('id', '=', roomId)
      .forNoKeyUpdate()
      .executeTakeFirst();

    if (!room) return null;

    await checkParticipants(trx, member.id, room, participantIds);

    const booking = await trx
      .insertInto('bookings')
      .values({
        member_id: member.id,
        room_id: roomId,
        starts_at: start,
        ends_at: end,
        cancelled_at: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    if (participantIds.length)
      await trx
        .insertInto('booking_participants')
        .values(
          participantIds.map((id) => ({
            booking_id: booking.id,
            member_id: id,
            added_at: clock(),
          })),
        )
        .execute();

    return booking;
  });

  if (!booking) return res.status(404).json({ error: 'Room not found.' });

  res.status(201).json(booking);
});

// The organizer changes who's invited. People who stay keep their answers.
router.put('/:id/participants', async (req, res: MemberResponse) => {
  const { db, clock, member } = res.locals;
  const { participantIds } = participantsInput.parse(req.body);
  const now = clock();

  await db.transaction().execute(async (trx) => {
    // Locked, so changes to one booking's people happen one at a time and a
    // cancellation can't slip in between the checks and the change.
    const booking = await findBooking(trx, req.params.id, member.id, true);
    if (!booking.organizer)
      throw new HttpError(403, 'Only the organizer can change who’s invited.');

    assertUpcoming(booking, now);

    const current = (
      await trx
        .selectFrom('booking_participants')
        .select('member_id')
        .where('booking_id', '=', req.params.id)
        .execute()
    ).map((row) => row.member_id);

    await checkParticipants(
      trx,
      member.id,
      { name: booking.room, capacity: booking.capacity },
      participantIds,
      current,
    );

    const removed = current.filter((id) => !participantIds.includes(id));
    const added = participantIds.filter((id) => !current.includes(id));

    if (removed.length)
      await trx
        .deleteFrom('booking_participants')
        .where('booking_id', '=', req.params.id)
        .where('member_id', 'in', removed)
        .execute();

    if (added.length)
      await trx
        .insertInto('booking_participants')
        .values(
          added.map((id) => ({
            booking_id: req.params.id,
            member_id: id,
            added_at: now,
          })),
        )
        .execute();
  });

  res.json(
    (await participantsOf(db, [req.params.id])).map(
      ({ bookingId: _, ...participant }) => participant,
    ),
  );
});

// A participant says whether they're coming. They can change their answer
// until the booking starts.
router.put('/:id/response', async (req, res: MemberResponse) => {
  const { db, clock, member } = res.locals;
  const { response } = responseInput.parse(req.body);
  const now = clock();

  const booking = await findBooking(db, req.params.id, member.id);
  if (booking.organizer)
    throw new HttpError(
      403,
      'You’re organizing this booking, so you’re always attending.',
    );

  assertUpcoming(booking, now);

  await db
    .updateTable('booking_participants')
    .set({ response, responded_at: now })
    .where('booking_id', '=', req.params.id)
    .where('member_id', '=', member.id)
    .execute();

  res.json({ response });
});

router.delete('/:id', async (req, res: MemberResponse) => {
  const { db, clock, member } = res.locals;

  const booking = await findBooking(db, req.params.id, member.id);
  if (!booking.organizer)
    throw new HttpError(
      403,
      'Only the organizer can cancel this booking. You can say you’re not attending instead.',
    );

  if (booking.cancelled_at) return res.sendStatus(204);

  const now = clock();
  if (booking.starts_at <= now)
    return res.status(409).json({ error: 'This booking has already started.' });

  await db
    .updateTable('bookings')
    .set({ cancelled_at: now })
    .where('id', '=', req.params.id)
    .where('cancelled_at', 'is', null)
    .execute();

  res.sendStatus(204);
});

export default router;
