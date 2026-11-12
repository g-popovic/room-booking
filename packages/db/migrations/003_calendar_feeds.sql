-- One private calendar feed link per member. Only a SHA-256 hash of the
-- link's token is stored, so the database can't be used to rebuild the URL.
CREATE TABLE calendar_feeds (
  member_id text PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
  token_hash bytea NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
