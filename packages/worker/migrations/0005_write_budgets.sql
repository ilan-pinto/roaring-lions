-- #559 M-3, M-4: write budgets for the public endpoints.
-- Apply to production BEFORE merge, from the branch worktree:
--   npx wrangler d1 migrations apply roaring-lions-telemetry --remote
--
-- M-3: /api/events stores ONE row per request, the request's validated events
-- as a JSON array, instead of one row per event across four indexes (an
-- event row was ~5 rows written; a 50-event request ~300 with the player
-- upserts). The dashboard reads `events_all`, which unions the legacy table
-- with the batches expanded by json_each, column for column. The legacy
-- `events` table is kept, read, and aged out by the daily cron.
CREATE TABLE event_batch (
  id INTEGER PRIMARY KEY,
  received_at INTEGER NOT NULL,
  player TEXT NOT NULL,
  events TEXT NOT NULL            -- JSON array of TelemetryEvent, all of this player
);

CREATE VIEW events_all AS
  SELECT type, player, session, tester, build, mission, t, received_at, dev, payload FROM events
  UNION ALL
  SELECT json_extract(j.value, '$.type'), json_extract(j.value, '$.player'), json_extract(j.value, '$.session'),
         json_extract(j.value, '$.tester'), json_extract(j.value, '$.build'), json_extract(j.value, '$.mission'),
         json_extract(j.value, '$.t'), b.received_at,
         CASE WHEN json_extract(j.value, '$.dev') = 1 THEN 1 ELSE 0 END, j.value
  FROM event_batch b, json_each(b.events) j;

-- M-3 and M-4: per-day counters. `scope` names the limit; `key` is a player
-- id, '' for a global ceiling, or for a per-IP limit a keyed hash of the IP
-- under a salt derived each day from a Worker secret -- never the IP itself.
-- Rows older than yesterday are deleted by the daily cron.
CREATE TABLE rate_day (
  scope TEXT NOT NULL,
  key TEXT NOT NULL,
  day INTEGER NOT NULL,           -- floor(epoch ms / 86,400,000)
  n INTEGER NOT NULL,
  PRIMARY KEY (scope, key, day)
) WITHOUT ROWID;
