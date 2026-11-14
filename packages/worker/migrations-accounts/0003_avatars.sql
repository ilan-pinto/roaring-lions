-- GH-1075 P4. Applied to production by the LEAD before the PR merges (merging deploys):
--   npx wrangler d1 migrations apply roaring-lions-accounts --remote
-- Two plain ADD COLUMNs on profile, so no table rebuild (unlike 0002_google.sql). Existing rows read NULL / 0, and NULL is
-- the default avatar, derived from the public id (@lions/data avatar.ts), so there is no backfill.
--   avatar: NULL = the default; 'p:<preset id>' = a preset (the id is checked in code against the catalogue, because a
--           CHECK cannot list a growing set); 'u' = an upload (reserved for the upload slices, nothing writes it yet).
ALTER TABLE profile ADD COLUMN avatar TEXT
  CHECK (avatar IS NULL OR avatar = 'u' OR (avatar GLOB 'p:*' AND length(avatar) <= 42));
ALTER TABLE profile ADD COLUMN avatar_rev INTEGER NOT NULL DEFAULT 0;
