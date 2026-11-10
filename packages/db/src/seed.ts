import { sql } from 'kysely';
import type { Kysely } from 'kysely';
import { ADMIN_ID, VENUE_TIME_ZONE } from './index.js';
import type { Database } from './index.js';

export const demoMembers = [
  { id: 'alex', name: 'Alex Morgan' },
  { id: 'sam', name: 'Sam Rivera' },
  { id: ADMIN_ID, name: 'Jamie Lee' },
];

export const demoRooms = [
  {
    name: 'The Nook',
    description: 'A quiet corner for a catch-up or an hour of focused work.',
    capacity: 2,
    amenities: ['Whiteboard', 'Window'],
  },
  {
    name: 'The Workshop',
    description:
      'A long table and plenty of space to get ideas out in the open.',
    capacity: 6,
    amenities: ['Whiteboard', 'Display'],
  },
  {
    name: 'The Studio',
    description:
      'Our largest room, with room to spread out and a screen everyone can see.',
    capacity: 10,
    amenities: ['Display', 'Video calls'],
  },
];

export async function seed(db: Kysely<Database>) {
  await db.transaction().execute(async (trx) => {
    const newMembers = await trx
      .insertInto('members')
      .values(demoMembers)
      .onConflict((oc) => oc.doNothing())
      .returning('id')
      .execute();
    if (!newMembers.some((member) => member.id === ADMIN_ID)) return;
    const rooms = await trx
      .insertInto('rooms')
      .values(demoRooms)
      .onConflict((oc) => oc.doNothing())
      .returning('id')
      .execute();

    const tomorrow = sql`(now() AT TIME ZONE ${VENUE_TIME_ZONE})::date + 1`;
    for (const [index, room] of rooms.entries()) {
      const start = sql<Date>`(${tomorrow} + make_time(${10 + index * 2}, 0, 0)) AT TIME ZONE ${VENUE_TIME_ZONE}`;
      const end = sql<Date>`${start} + interval '1 hour'`;
      await trx
        .insertInto('bookings')
        .values({
          member_id: index === 0 ? 'alex' : 'sam',
          room_id: room.id,
          starts_at: start,
          ends_at: end,
          cancelled_at: null,
        })
        .execute();
    }
  });
}
