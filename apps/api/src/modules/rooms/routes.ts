import { VENUE_TIME_ZONE } from '@room-booking/db';
import { Router } from 'express';
import { z } from 'zod';

import type { AppResponse } from '../../app-locals.js';
import { requireAdmin } from '../../middleware/auth.js';
import { availableSlots, dayWindow, venueDate } from '../bookings/schedule.js';

const router = Router();

const roomInput = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(300),
  capacity: z.number().int().min(1).max(100),
  amenities: z.array(z.string().trim().min(1).max(40)).max(12),
});
const positiveId = z.coerce.number().int().positive().max(2_147_483_647);

router.get('/', async (req, res: AppResponse) => {
  const { db, clock } = res.locals;
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

router.post('/', requireAdmin, async (req, res: AppResponse) => {
  const { db } = res.locals;

  const room = await db
    .insertInto('rooms')
    .values(roomInput.parse(req.body))
    .returningAll()
    .executeTakeFirstOrThrow();

  res.status(201).json(room);
});

router.put('/:id', requireAdmin, async (req, res: AppResponse) => {
  const { db } = res.locals;

  const room = await db
    .updateTable('rooms')
    .set(roomInput.parse(req.body))
    .where('id', '=', positiveId.parse(req.params.id))
    .returningAll()
    .executeTakeFirst();

  if (!room) return res.status(404).json({ error: 'Room not found.' });

  res.json(room);
});

export default router;
