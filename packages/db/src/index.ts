import { Kysely, PostgresDialect } from 'kysely';
import type { Generated } from 'kysely';
import pg from 'pg';

export const ADMIN_ID = 'operator';
export const VENUE_TIME_ZONE = 'Europe/Podgorica';

export interface Database {
  members: { id: string; name: string };
  rooms: {
    id: Generated<number>;
    name: string;
    description: string;
    capacity: number;
    amenities: string[];
  };
  bookings: {
    id: Generated<string>;
    member_id: string;
    room_id: number;
    starts_at: Date;
    ends_at: Date;
    cancelled_at: Date | null;
  };
}

export function createDatabase(connectionString: string) {
  return new Kysely<Database>({
    dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString }) }),
  });
}
