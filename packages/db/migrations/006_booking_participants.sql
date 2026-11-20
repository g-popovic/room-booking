-- People invited to a booking, and their answers. The person who made the
-- booking (bookings.member_id) is its organizer: always attending, and never
-- listed here.

CREATE TABLE booking_participants (
  booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  member_id text NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  response text NOT NULL DEFAULT 'pending'
    CHECK (response IN ('pending', 'attending', 'not_attending')),
  added_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  CHECK ((response = 'pending') = (responded_at IS NULL)),
  PRIMARY KEY (booking_id, member_id)
);

-- "Which bookings am I invited to?" is the common lookup.
CREATE INDEX booking_participants_member_idx
  ON booking_participants (member_id);

-- A booking's organizer never changes, so checking on insert is enough.
CREATE FUNCTION participant_is_not_organizer() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM bookings
    WHERE id = NEW.booking_id AND member_id = NEW.member_id
  ) THEN
    RAISE EXCEPTION 'The organizer of booking % can''t be a participant.',
      NEW.booking_id
      USING ERRCODE = 'check_violation',
        CONSTRAINT = 'participant_is_not_organizer';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER participant_is_not_organizer
  BEFORE INSERT OR UPDATE OF booking_id, member_id ON booking_participants
  FOR EACH ROW EXECUTE FUNCTION participant_is_not_organizer();
