-- Teams, their members, and invitations by email.

CREATE TABLE teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Not unique: a unique name would let anyone check whether a team called
  -- something exists by trying to create one.
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE team_members (
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  member_id text NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner', 'member')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, member_id)
);

-- "Which teams am I in?" is the most common lookup.
CREATE INDEX team_members_member_idx ON team_members (member_id);

-- Every team has at least one owner. Built-in constraints only see one row
-- (CHECK) or compare pairs of rows (UNIQUE, EXCLUDE), so this is a constraint
-- trigger. It runs at commit, so a transaction can promote one owner and
-- demote another in either order.
--
-- The check locks the team's row first. Without that, two owners demoting each
-- other at the same moment would each still see the other as owner, both
-- checks would pass, and the team would be left with none. With the lock, the
-- second check waits for the first transaction to finish and then sees its
-- change. Code that changes a team's members should lock the team's row before
-- anything else, as the API does; otherwise concurrent changes can deadlock.
-- PostgreSQL then aborts one of them, so the rule still holds.
CREATE FUNCTION team_has_owner() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  team uuid;
BEGIN
  -- Separate branches, because PL/pgSQL prepares a whole expression at once
  -- and a teams row has no team_id.
  IF TG_TABLE_NAME = 'teams' THEN
    team := NEW.id;
  ELSE
    team := OLD.team_id;
  END IF;

  PERFORM 1 FROM teams WHERE id = team FOR NO KEY UPDATE;

  -- A team deleted in this transaction takes its members with it.
  IF FOUND AND NOT EXISTS (
    SELECT 1 FROM team_members WHERE team_id = team AND role = 'owner'
  ) THEN
    RAISE EXCEPTION 'Team % needs at least one owner.', team
      USING ERRCODE = 'check_violation', CONSTRAINT = 'team_has_owner';
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER team_has_owner
  AFTER INSERT ON teams
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION team_has_owner();

CREATE CONSTRAINT TRIGGER team_keeps_owner
  AFTER UPDATE OR DELETE ON team_members
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION team_has_owner();

CREATE TABLE team_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  -- Trimmed and lowercased like members.email. Deliberately not linked to
  -- members: inviting works the same whether or not anyone has this address,
  -- and the invite waits for someone who registers with it later.
  email text NOT NULL,
  invited_by text REFERENCES members(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  -- A pending invite past this time has expired.
  expires_at timestamptz NOT NULL CHECK (expires_at > created_at),
  responded_at timestamptz,
  CHECK ((status = 'pending') = (responded_at IS NULL)),
  -- An address can be invited to a team again only once the previous invite's
  -- lifetime is over, whether it is still pending or was declined. Cancelled
  -- and accepted invites don't count, so a member who leaves can be invited
  -- back straight away.
  CONSTRAINT team_invites_one_at_a_time EXCLUDE USING gist (
    team_id WITH =,
    email WITH =,
    tstzrange(created_at, expires_at, '[)') WITH &&
  ) WHERE (status IN ('pending', 'declined'))
);

-- "What invites do I have?" looks up by the signed-in member's email.
CREATE INDEX team_invites_email_idx ON team_invites (email)
  WHERE status = 'pending';
