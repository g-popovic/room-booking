import { Router } from 'express';
import { DateTime } from 'luxon';

import type { AppResponse, MemberResponse } from '../../app-locals.js';
import { requireMember } from '../../middleware/auth.js';
import { buildCalendar } from './ics.js';
import {
  createFeedToken,
  feedPath,
  hashFeedToken,
  isFeedToken,
} from './token.js';

const CALENDAR_NAME = 'Roomwell';
const PRODUCT_ID = '-//Roomwell//Booking calendar//EN';
const LOCATION = 'The Commons, Podgorica';
const DESCRIPTION =
  'Meeting room booked through Roomwell. To cancel, use My bookings in Roomwell.';
const invitedDescription = (organizer: string) =>
  `${organizer} invited you to this meeting room booking on Roomwell. To answer, use My bookings in Roomwell.`;
// Past bookings stay in the feed for a year so they don't vanish from the
// member's calendar history as soon as they end.
const HISTORY_MONTHS = 12;

// Signed-in members manage their private feed link here.
export const calendarFeedRoutes = Router();

calendarFeedRoutes.use(requireMember);

calendarFeedRoutes.get('/', async (_req, res: MemberResponse) => {
  const { db, member } = res.locals;
  const memberId = member.id;

  const feed = await db
    .selectFrom('calendar_feeds')
    .select('created_at as createdAt')
    .where('member_id', '=', memberId)
    .executeTakeFirst();

  res.json(feed ?? null);
});

// Creates the member's link, or replaces it so the previous one stops working.
// The token is returned only in this response; only its hash is stored.
calendarFeedRoutes.post('/', async (_req, res: MemberResponse) => {
  const { db, clock, member } = res.locals;
  const memberId = member.id;

  const { token, hash } = createFeedToken();
  const now = clock();

  await db
    .insertInto('calendar_feeds')
    .values({ member_id: memberId, token_hash: hash, created_at: now })
    .onConflict((oc) =>
      oc.column('member_id').doUpdateSet({ token_hash: hash, created_at: now }),
    )
    .execute();

  res.status(201).json({ path: feedPath(token), createdAt: now });
});

calendarFeedRoutes.delete('/', async (_req, res: MemberResponse) => {
  const { db, member } = res.locals;
  const memberId = member.id;

  await db
    .deleteFrom('calendar_feeds')
    .where('member_id', '=', memberId)
    .execute();

  res.sendStatus(204);
});

// Public feed fetched by calendar apps. Calendar servers don't carry the
// session cookie, so the token in the URL is what identifies the member.
export const calendarRoutes = Router();

calendarRoutes.get('/:token.ics', async (req, res: AppResponse) => {
  const { db, clock } = res.locals;
  const { token } = req.params;

  const feed = isFeedToken(token)
    ? await db
        .selectFrom('calendar_feeds')
        .select('member_id')
        .where('token_hash', '=', hashFeedToken(token))
        .executeTakeFirst()
    : undefined;

  if (!feed) return res.status(404).json({ error: 'Calendar not found.' });

  const now = clock();
  const since = DateTime.fromJSDate(now, { zone: 'utc' })
    .minus({ months: HISTORY_MONTHS })
    .toJSDate();

  // Bookings the member organizes or is invited to. Cancelled ones, and ones
  // they said they won't attend, are left out; calendar apps delete events
  // that disappear from a subscribed feed.
  const bookings = await db
    .selectFrom('bookings')
    .innerJoin('rooms', 'rooms.id', 'bookings.room_id')
    .innerJoin('members as organizer', 'organizer.id', 'bookings.member_id')
    .leftJoin('booking_participants as me', (join) =>
      join
        .onRef('me.booking_id', '=', 'bookings.id')
        .on('me.member_id', '=', feed.member_id),
    )
    .select([
      'bookings.id',
      'rooms.name as room',
      'starts_at',
      'ends_at',
      'organizer.name as organizer',
      'me.member_id as participant',
    ])
    .where((eb) =>
      eb.or([
        eb('bookings.member_id', '=', feed.member_id),
        eb('me.response', 'in', ['pending', 'attending']),
      ]),
    )
    .where('cancelled_at', 'is', null)
    .where('ends_at', '>=', since)
    .orderBy('starts_at')
    .execute();

  const calendar = buildCalendar(
    { name: CALENDAR_NAME, productId: PRODUCT_ID },
    bookings.map((booking) => ({
      uid: `${booking.id}@roomwell`,
      start: booking.starts_at,
      end: booking.ends_at,
      summary: `${booking.room} · Roomwell`,
      location: LOCATION,
      description: booking.participant
        ? invitedDescription(booking.organizer)
        : DESCRIPTION,
    })),
    now,
  );

  res.type('text/calendar; charset=utf-8').send(calendar);
});
