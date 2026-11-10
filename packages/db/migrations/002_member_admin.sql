ALTER TABLE members
  ADD COLUMN is_admin boolean NOT NULL DEFAULT false;

UPDATE members
SET is_admin = true
WHERE id = 'operator';
