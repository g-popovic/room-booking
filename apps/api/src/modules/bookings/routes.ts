import type { DatabaseClient } from '@room-booking/db';
import { Router } from 'express';
import { z } from 'zod';
import type { DemoSessions } from '../auth/demo-session.js';
import { validBookingWindow } from './schedule.js';

const bookingInput = z.object({
  roomId: z.number().int().positive(),
  start: z.iso.datetime().transform((value) => new Date(value)),
  end: z.iso.datetime().transform((value) => new Date(value)),
});

export function createBookingRoutes(
  db: DatabaseClient,
  sessions: DemoSessions,
  clock: () => Date,
) {
  const router = Router();

  router.get('/', async (req, res) => {
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

  router.post('/', async (req, res) => {
    const memberId = sessions.read(req);
    if (!memberId)
      return res
        .status(401)
        .json({ error: 'Choose a demo account to book a room.' });
    const { roomId, start, end } = bookingInput.parse(req.body);
    if (!validBookingWindow(start, end, clock())) {
      return res.status(400).json({
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

  router.delete('/:id', async (req, res) => {
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

  return router;
}
