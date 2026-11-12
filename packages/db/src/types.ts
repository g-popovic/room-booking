import type { Generated } from 'kysely';

export interface Database {
  members: {
    id: string;
    name: string;
    is_admin: Generated<boolean>;
  };

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

  calendar_feeds: {
    member_id: string;
    token_hash: Buffer;
    created_at: Generated<Date>;
  };
}
