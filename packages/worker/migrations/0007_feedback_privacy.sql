-- GH-1417 C2: a private "privacy" category (and a "privacy" source) for POST /api/feedback.
-- Widens the CHECKs of 0003. SQLite cannot alter a CHECK, so `feedback` is rebuilt, and because
-- DROP TABLE on a parent runs an implicit DELETE that would CASCADE into the attachments, the two
-- child tables are copied aside first and rebuilt after. Every row, id, index and blob survives.
-- Applied to production by the lead BEFORE merge, with:
--   npx wrangler d1 migrations apply roaring-lions-telemetry --remote
CREATE TABLE feedback_picture_keep AS SELECT feedback_id, bytes FROM feedback_picture;
CREATE TABLE feedback_replay_keep AS SELECT feedback_id, json FROM feedback_replay;
DROP TABLE feedback_picture;
DROP TABLE feedback_replay;

ALTER TABLE feedback RENAME TO feedback_old;
DROP INDEX feedback_status;
DROP INDEX feedback_tester;
DROP INDEX feedback_mission;
DROP INDEX feedback_player;
DROP INDEX feedback_session;
DROP INDEX feedback_received;

CREATE TABLE feedback (
  id INTEGER PRIMARY KEY,
  received_at INTEGER NOT NULL,
  t INTEGER NOT NULL,
  player TEXT, session TEXT,
  tester TEXT,
  build TEXT NOT NULL, "commit" TEXT,
  source TEXT NOT NULL CHECK (source IN ('pause','debrief','menu','privacy')),
  category TEXT NOT NULL CHECK (category IN ('bug','balance','confusing','idea','praise','rating','privacy')),
  rating INTEGER CHECK (rating BETWEEN 1 AND 5),
  text TEXT NOT NULL DEFAULT '',
  contact TEXT,
  mission TEXT, map TEXT, tick INTEGER,
  context TEXT NOT NULL,
  shot_bytes INTEGER,
  replay_bytes INTEGER,
  dev INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','triaged','filed','dismissed')),
  issue INTEGER, note TEXT,
  updated_at INTEGER NOT NULL
);
INSERT INTO feedback SELECT * FROM feedback_old;
DROP TABLE feedback_old;
CREATE INDEX feedback_status  ON feedback (status, received_at);
CREATE INDEX feedback_tester  ON feedback (tester, received_at);
CREATE INDEX feedback_mission ON feedback (mission, received_at);
CREATE INDEX feedback_player  ON feedback (player, received_at);
CREATE INDEX feedback_session ON feedback (session, received_at);
CREATE INDEX feedback_received ON feedback (received_at);

CREATE TABLE feedback_picture (
  feedback_id INTEGER PRIMARY KEY REFERENCES feedback (id) ON DELETE CASCADE,
  bytes BLOB NOT NULL
);
CREATE TABLE feedback_replay (
  feedback_id INTEGER PRIMARY KEY REFERENCES feedback (id) ON DELETE CASCADE,
  json TEXT NOT NULL
);
INSERT INTO feedback_picture SELECT feedback_id, bytes FROM feedback_picture_keep;
INSERT INTO feedback_replay SELECT feedback_id, json FROM feedback_replay_keep;
DROP TABLE feedback_picture_keep;
DROP TABLE feedback_replay_keep;
