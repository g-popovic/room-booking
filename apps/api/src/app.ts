import express from 'express';
import type {
  ErrorRequestHandler,
  NextFunction,
  Request,
  Response,
} from 'express';
import { z } from 'zod';
import { ADMIN_ID, VENUE_TIME_ZONE } from '@room-booking/db';
import type { createDatabase } from '@room-booking/db';
import {
  availableSlots,
  dayWindow,
  validBookingWindow,
  venueDate,
} from './schedule.js';
import { createDemoSessions } from './session.js';

const memberInput = z.object({ id: z.string().min(1) });
const bookingInput = z.object({
  roomId: z.number().int().positive(),
  start: z.iso.datetime().transform((value) => new Date(value)),
  end: z.iso.datetime().transform((value) => new Date(value)),
});
const roomInput = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(300),
  capacity: z.number().int().min(1).max(100),
  amenities: z.array(z.string().trim().min(1).max(40)).max(12),
});
const positiveId = z.coerce.number().int().positive().max(2_147_483_647);

export function createApp(
  db: ReturnType<typeof createDatabase>,
  clock = () => new Date(),
) {
  const app = express();
  const sessions = createDemoSessions();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '16kb' }));
  app.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  const requireAdmin = (req: Request, res: Response, next: NextFunction) => {
    if (sessions.read(req) !== ADMIN_ID) {
      res.status(403).json({ error: 'Only the venue admin can manage rooms.' });
      return;
    }
    next();
  };

  app.get('/api/session', async (req, res) => {
    const members = await db
      .selectFrom('members')
      .selectAll()
      .orderBy('name')
      .execute();
    const accounts = members.map((member) => ({
      ...member,
      isAdmin: member.id === ADMIN_ID,
    }));
    res.json({
      account:
        accounts.find((account) => account.id === sessions.read(req)) ?? null,
      accounts,
    });
  });

  app.post('/api/session', async (req, res) => {
    const { id } = memberInput.parse(req.body);
    const member = await db
      .selectFrom('members')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!member)
      return res.status(404).json({ error: 'Demo account not found.' });
    sessions.set(res, id);
    res.json({ ...member, isAdmin: member.id === ADMIN_ID });
  });

  app.delete('/api/session', (_req, res) => {
    sessions.clear(res);
    res.sendStatus(204);
  });

  app.get('/api/rooms', async (req, res) => {
    const now = clock();
    const date = req.query.date ?? venueDate(now);
    const window = typeof date === 'string' ? dayWindow(date) : null;
    if (!window) return res.status(400).json({ error: 'Choose a valid date.' });

    const [rooms, bookings] = await Promise.all([
      db.selectFrom('rooms').selectAll().orderBy('id').execute(),
      db
        .selectFrom('bookings')
        .select(['room_id', 'starts_at', 'ends_at'])
        .where('cancelled_at', 'is', null)
        .where('starts_at', '<', window.end)
        .where('ends_at', '>', window.start)
        .execute(),
    ]);
    res.json({
      date,
      timeZone: VENUE_TIME_ZONE,
      rooms: rooms.map((room) => ({
        ...room,
        slots: availableSlots(
          window,
          bookings.filter((booking) => booking.room_id === room.id),
          now,
        ),
      })),
    });
  });

  app.post('/api/rooms', requireAdmin, async (req, res) => {
    const room = await db
      .insertInto('rooms')
      .values(roomInput.parse(req.body))
      .returningAll()
      .executeTakeFirstOrThrow();
    res.status(201).json(room);
  });

  app.put('/api/rooms/:id', requireAdmin, async (req, res) => {
    const room = await db
      .updateTable('rooms')
      .set(roomInput.parse(req.body))
      .where('id', '=', positiveId.parse(req.params.id))
      .returningAll()
      .executeTakeFirst();
    if (!room) return res.status(404).json({ error: 'Room not found.' });
    res.json(room);
  });

  app.get('/api/bookings', async (req, res) => {
    const memberId = sessions.read(req);
    if (!memberId)
      return res
        .status(401)
        .json({ error: 'Choose a demo account to see your bookings.' });
    const bookings = await db
      .selectFrom('bookings')
      .innerJoin('rooms', 'rooms.id', 'bookings.room_id')
      .select([
        'bookings.id',
        'rooms.name as room',
        'starts_at as start',
        'ends_at as end',
        'cancelled_at as cancelled',
      ])
      .where('member_id', '=', memberId)
      .orderBy('starts_at', 'desc')
      .execute();
    res.json(bookings);
  });

  app.post('/api/bookings', async (req, res) => {
    const memberId = sessions.read(req);
    if (!memberId)
      return res
        .status(401)
        .json({ error: 'Choose a demo account to book a room.' });
    const { roomId, start, end } = bookingInput.parse(req.body);
    if (!validBookingWindow(start, end, clock())) {
      return res
        .status(400)
        .json({
          error:
            'Choose a future time between 08:00 and 20:00 in 30-minute increments.',
        });
    }
    const room = await db
      .selectFrom('rooms')
      .select('id')
      .where('id', '=', roomId)
      .executeTakeFirst();
    if (!room) return res.status(404).json({ error: 'Room not found.' });
    const booking = await db
      .insertInto('bookings')
      .values({
        member_id: memberId,
        room_id: roomId,
        starts_at: start,
        ends_at: end,
        cancelled_at: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    res.status(201).json(booking);
  });

  app.delete('/api/bookings/:id', async (req, res) => {
    const memberId = sessions.read(req);
    if (!memberId)
      return res
        .status(401)
        .json({ error: 'Choose a demo account to cancel a booking.' });
    const id = z.uuid().parse(req.params.id);
    const booking = await db
      .selectFrom('bookings')
      .select(['starts_at', 'cancelled_at'])
      .where('id', '=', id)
      .where('member_id', '=', memberId)
      .executeTakeFirst();
    if (!booking) return res.status(404).json({ error: 'Booking not found.' });
    if (booking.cancelled_at) return res.sendStatus(204);
    const now = clock();
    if (booking.starts_at <= now)
      return res
        .status(409)
        .json({ error: 'This booking has already started.' });
    await db
      .updateTable('bookings')
      .set({ cancelled_at: now })
      .where('id', '=', id)
      .where('cancelled_at', 'is', null)
      .execute();
    res.sendStatus(204);
  });

  const handleError: ErrorRequestHandler = (error, _req, res, _next) => {
    if (error instanceof z.ZodError || error.status === 400) {
      res.status(400).json({ error: 'Check the fields and try again.' });
    } else if (error.code === '23P01') {
      res
        .status(409)
        .json({
          error: 'That time is no longer available. Choose another slot.',
        });
    } else if (error.code === '23505') {
      res.status(409).json({ error: 'A room with that name already exists.' });
    } else {
      console.error(error);
      res.status(500).json({ error: 'Something went wrong. Try again.' });
    }
  };
  app.use(handleError);
  return app;
}
