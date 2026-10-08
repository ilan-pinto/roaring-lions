-- GH-464: in-game feedback (spec docs/superpowers/specs/2026-10-08-in-game-feedback-design.md
-- §5.1). One row per note a player sends; the picture and the replay live in
-- R2 (binding FEEDBACK_BLOBS) under shot_key / log_key. No IP is stored.
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
  shot_key TEXT, log_key TEXT,        -- R2 keys; NULL when not attached (or purged)
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
