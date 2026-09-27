-- GH-254: the latest brigade-account snapshot per player, so /stats reads one
-- row per player. Rebuildable from events (QUERIES.sql). Applied to production
-- by the lead BEFORE merge, with:
--   npx wrangler d1 migrations apply roaring-lions-telemetry --remote
CREATE TABLE accounts (
  player TEXT PRIMARY KEY,
  t INTEGER NOT NULL,
  credits INTEGER NOT NULL,
  earned INTEGER NOT NULL,
  unlocks TEXT NOT NULL,
  tiers TEXT NOT NULL,
  tester TEXT,
  dev INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX accounts_t ON accounts (t);
