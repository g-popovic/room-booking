-- Email and password sign-in, with sessions stored in the database.

-- New accounts get a random ID. The demo accounts keep their readable ones.
ALTER TABLE members
  ALTER COLUMN id SET DEFAULT gen_random_uuid()::text,
  ADD COLUMN email text,
  ADD COLUMN password_hash text,
  ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();

-- Existing members need an email before the column can be required. The demo
-- accounts get the addresses the seed uses. Anything else gets a placeholder
-- on the reserved .invalid domain, and has no password until one is set.
UPDATE members
SET email = CASE id
  WHEN 'alex' THEN 'alex@roomwell.test'
  WHEN 'sam' THEN 'sam@roomwell.test'
  WHEN 'operator' THEN 'jamie@roomwell.test'
  ELSE id || '@members.roomwell.invalid'
END;

-- The API trims and lowercases emails before storing or comparing them, so a
-- plain unique constraint is enough to stop duplicates that differ in case.
ALTER TABLE members
  ALTER COLUMN email SET NOT NULL,
  ADD CONSTRAINT members_email_key UNIQUE (email);

-- password_hash stays nullable: a member without one can't sign in with a
-- password.

-- Only a SHA-256 hash of each session token is stored, as with calendar feeds,
-- so the table can't be used to take over a session.
CREATE TABLE sessions (
  token_hash bytea PRIMARY KEY,
  member_id text NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE INDEX sessions_member_idx ON sessions (member_id);
