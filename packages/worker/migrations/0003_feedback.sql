-- GH-464: in-game feedback (spec docs/superpowers/specs/2026-10-08-in-game-feedback-design.md
-- §5.1, §12). One row per note a player sends. The picture and the replay
-- live in D1 too, in their own tables keyed by feedback id, so the list and
-- the badge never read a blob (lead's ruling 2026-10-08: everything in D1). No IP is
-- stored.
-- Applied to production by the lead BEFORE merge, with:
--   npx wrangler d1 migrations apply roaring-lions-telemetry --remote
CREATE TABLE feedback (
  id INTEGER PRIMARY KEY,
  received_at INTEGER NOT NULL,
  t INTEGER NOT NULL,                 -- client epoch ms
  player TEXT, session TEXT,          -- NULL under opt-out
  tester TEXT,
  build TEXT NOT NULL, "commit" TEXT,
  source TEXT NOT NULL CHECK (source IN ('pause','debrief','menu')),
  category TEXT NOT NULL CHECK (category IN ('bug','balance','confusing','idea','praise','rating')),
  rating INTEGER CHECK (rating BETWEEN 1 AND 5),
  text TEXT NOT NULL DEFAULT '',
  contact TEXT,
  mission TEXT, map TEXT, tick INTEGER,
  context TEXT NOT NULL,              -- JSON, <= 8 KB
  shot_bytes INTEGER,                 -- size of the feedback_picture row; NULL when none (or purged)
  replay_bytes INTEGER,               -- size of the feedback_replay row; NULL when none (or purged)
  dev INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','triaged','filed','dismissed')),
  issue INTEGER, note TEXT,
  updated_at INTEGER NOT NULL
);
CREATE INDEX feedback_status  ON feedback (status, received_at);
CREATE INDEX feedback_tester  ON feedback (tester, received_at);
CREATE INDEX feedback_mission ON feedback (mission, received_at);
CREATE INDEX feedback_player  ON feedback (player, received_at);
CREATE INDEX feedback_session ON feedback (session, received_at);
CREATE INDEX feedback_received ON feedback (received_at);

-- The attachments, one row each at most, keyed by the note's id. Kept out of
-- `feedback` so `SELECT ... FROM feedback` never pages a blob in. The picture
-- is WebP, at most 64 KB; the replay is JSON, at most 96 KB. `feedback_id` is
-- the rowid, so last_insert_rowid() after an insert here is still the note's.
CREATE TABLE feedback_picture (
  feedback_id INTEGER PRIMARY KEY REFERENCES feedback (id) ON DELETE CASCADE,
  bytes BLOB NOT NULL
);
CREATE TABLE feedback_replay (
  feedback_id INTEGER PRIMARY KEY REFERENCES feedback (id) ON DELETE CASCADE,
  json TEXT NOT NULL
);

-- Server-side switches the lead flips without deploying the app. One row per
-- switch; a missing row means the default (open). Today only `feedback`:
--   value 'closed' -> POST /api/feedback answers 410 and GET answers {"open":false}.
-- Flipped from /stats/feedback, or by hand:
--   npx wrangler d1 execute roaring-lions-telemetry --remote --command \
--     "INSERT INTO flags (name, value, updated_at) VALUES ('feedback', 'closed', unixepoch() * 1000)
--      ON CONFLICT (name) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
CREATE TABLE flags (
  name TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
