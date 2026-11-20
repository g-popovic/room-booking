import { sql } from 'kysely';
import type { Kysely } from 'kysely';
import { VENUE_TIME_ZONE } from './index.js';
import type { Database } from './index.js';
import { hashPassword } from './password.js';

// Every demo account signs in with this password. It's listed in the README.
export const DEMO_PASSWORD = 'roomwell-demo';

export const demoMembers = [
  { id: 'alex', name: 'Alex Morgan', email: 'alex@roomwell.test' },
  { id: 'sam', name: 'Sam Rivera', email: 'sam@roomwell.test' },
  {
    id: 'operator',
    name: 'Jamie Lee',
    email: 'jamie@roomwell.test',
    is_admin: true,
  },
];

// A team with every demo account in it, so teammates can be invited to
// bookings straight away. Jamie, the venue admin, owns it.
export const demoTeam = {
  // Fixed, like the demo accounts' IDs, so setup can run again safely.
  id: '00000000-0000-4000-8000-00000000c0a1',
  name: 'The Commons',
  owner: 'operator',
};

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
  const members = await Promise.all(
    demoMembers.map(async (member) => ({
      ...member,
      password_hash: await hashPassword(DEMO_PASSWORD),
    })),
  );

  await db.transaction().execute(async (trx) => {
    const newMembers = await trx
      .insertInto('members')
      .values(members)
      .onConflict((oc) => oc.doNothing())
      .returning('is_admin')
      .execute();

    // Demo accounts created before passwords existed get one now.
    for (const member of members) {
      await trx
        .updateTable('members')
        .set({ password_hash: member.password_hash })
        .where('id', '=', member.id)
        .where('password_hash', 'is', null)
        .execute();
    }

    // Runs on every setup, so existing databases get the team too. A demo
    // account that left it, or a deleted team, comes back.
    await trx
      .insertInto('teams')
      .values({ id: demoTeam.id, name: demoTeam.name })
      .onConflict((oc) => oc.doNothing())
      .execute();
    await trx
      .insertInto('team_members')
      .values(
        demoMembers.map((member) => ({
          team_id: demoTeam.id,
          member_id: member.id,
          role:
            member.id === demoTeam.owner
              ? ('owner' as const)
              : ('member' as const),
        })),
      )
      .onConflict((oc) => oc.doNothing())
      .execute();

    if (!newMembers.some((member) => member.is_admin)) return;

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
