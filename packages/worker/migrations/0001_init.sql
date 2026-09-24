-- WP-T1 telemetry store. Raw events are kept forever; `players` is an upserted
-- summary so the dashboard's headline numbers are one query.
CREATE TABLE events (
  id INTEGER PRIMARY KEY,
  type TEXT NOT NULL,
  player TEXT NOT NULL,
  session TEXT NOT NULL,
  tester TEXT,
  build TEXT NOT NULL,
  mission TEXT,
  t INTEGER NOT NULL,
  received_at INTEGER NOT NULL,
  dev INTEGER NOT NULL DEFAULT 0,
  payload TEXT NOT NULL
);
CREATE INDEX events_type_t ON events (type, t);
CREATE INDEX events_player ON events (player, t);
CREATE INDEX events_mission ON events (mission, type);
CREATE INDEX events_tester ON events (tester, t);

CREATE TABLE players (
  player TEXT PRIMARY KEY,
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  seconds_played INTEGER NOT NULL DEFAULT 0,
  missions_won INTEGER NOT NULL DEFAULT 0,
  last_won TEXT,
  tester TEXT,
  dev INTEGER NOT NULL DEFAULT 0
);
