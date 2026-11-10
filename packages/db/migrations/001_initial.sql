CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE members (
  id text PRIMARY KEY,
  name text NOT NULL
);

CREATE TABLE rooms (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL UNIQUE,
  description text NOT NULL,
  capacity integer NOT NULL CHECK (capacity > 0),
  amenities text[] NOT NULL
);

CREATE TABLE bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id text NOT NULL REFERENCES members(id),
  room_id integer NOT NULL REFERENCES rooms(id),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL CHECK (ends_at > starts_at),
  cancelled_at timestamptz,
  CONSTRAINT bookings_no_overlap EXCLUDE USING gist (
    room_id WITH =,
    tstzrange(starts_at, ends_at, '[)') WITH &&
  ) WHERE (cancelled_at IS NULL)
);

CREATE INDEX bookings_member_idx ON bookings (member_id, starts_at);
