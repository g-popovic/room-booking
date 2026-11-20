import type { Generated } from 'kysely';

export interface Database {
  members: {
    id: Generated<string>;
    name: string;
    // Stored trimmed and lowercased.
    email: string;
    // Null means the member can't sign in with a password.
    password_hash: string | null;
    is_admin: Generated<boolean>;
    created_at: Generated<Date>;
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

  sessions: {
    token_hash: Buffer;
    member_id: string;
    created_at: Generated<Date>;
    expires_at: Date;
  };

  teams: {
    id: Generated<string>;
    name: string;
    created_at: Generated<Date>;
  };

  team_members: {
    team_id: string;
    member_id: string;
    role: 'owner' | 'member';
    joined_at: Generated<Date>;
  };

  team_invites: {
    id: Generated<string>;
    team_id: string;
    // Stored trimmed and lowercased, like members.email.
    email: string;
    invited_by: string | null;
    status: Generated<'pending' | 'accepted' | 'declined' | 'cancelled'>;
    created_at: Generated<Date>;
    expires_at: Date;
    responded_at: Date | null;
  };

  booking_participants: {
    booking_id: string;
    member_id: string;
    response: Generated<'pending' | 'attending' | 'not_attending'>;
    added_at: Generated<Date>;
    responded_at: Date | null;
  };

  calendar_feeds: {
    member_id: string;
    token_hash: Buffer;
    created_at: Generated<Date>;
  };
}
