import { Router } from 'express';
import { DateTime } from 'luxon';

import type { AppResponse } from '../../app-locals.js';
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
// Past bookings stay in the feed for a year so they don't vanish from the
// member's calendar history as soon as they end.
const HISTORY_MONTHS = 12;

// Signed-in members manage their private feed link here.
export const calendarFeedRoutes = Router();

calendarFeedRoutes.get('/', async (req, res: AppResponse) => {
  const { db, sessions } = res.locals;
  const memberId = sessions.read(req);

  if (!memberId)
    return res
      .status(401)
      .json({ error: 'Choose a demo account to set up calendar sync.' });

  const feed = await db
    .selectFrom('calendar_feeds')
    .select('created_at as createdAt')
    .where('member_id', '=', memberId)
    .executeTakeFirst();

  res.json(feed ?? null);
});

// Creates the member's link, or replaces it so the previous one stops working.
// The token is returned only in this response; only its hash is stored.
calendarFeedRoutes.post('/', async (req, res: AppResponse) => {
  const { db, sessions, clock } = res.locals;
  const memberId = sessions.read(req);

  if (!memberId)
    return res
      .status(401)
      .json({ error: 'Choose a demo account to set up calendar sync.' });

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

calendarFeedRoutes.delete('/', async (req, res: AppResponse) => {
  const { db, sessions } = res.locals;
  const memberId = sessions.read(req);

  if (!memberId)
    return res
      .status(401)
      .json({ error: 'Choose a demo account to set up calendar sync.' });

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

  // Cancelled bookings are left out; calendar apps delete events that
  // disappear from a subscribed feed.
  const bookings = await db
    .selectFrom('bookings')
    .innerJoin('rooms', 'rooms.id', 'bookings.room_id')
    .select(['bookings.id', 'rooms.name as room', 'starts_at', 'ends_at'])
    .where('member_id', '=', feed.member_id)
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
      description: DESCRIPTION,
    })),
    now,
  );

  res.type('text/calendar; charset=utf-8').send(calendar);
});
