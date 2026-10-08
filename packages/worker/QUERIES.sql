-- Ready-made telemetry queries (WP-T1). Run one against the live database with:
--   npx wrangler d1 execute roaring-lions-telemetry --remote --file packages/worker/QUERIES.sql
-- or paste a single query into --command "...". Every query skips sandbox traffic (dev = 0).
-- Durations are in ticks at 20 Hz: 1200 ticks = 1 minute.
-- This is an alternative route to the same numbers as the /stats page, not a
-- stand-in for a closed one -- /stats is behind a password login (STATS_PASSWORD).

-- @players_per_day
SELECT date(t / 1000, 'unixepoch') AS day, COUNT(DISTINCT player) AS players
FROM events WHERE dev = 0
GROUP BY day ORDER BY day;

-- @results_by_mission
SELECT mission, json_extract(payload, '$.result') AS result, COUNT(*) AS runs
FROM events WHERE dev = 0 AND type = 'mission_end'
GROUP BY mission, result ORDER BY mission, result;

-- @median_win_minutes
-- Compare against each mission's target_minutes (data/missions/<id>.json, or
-- MISSION_TARGET_MINUTES in packages/worker/src/campaign-order.ts).
WITH wins AS (
  SELECT mission,
         json_extract(payload, '$.tick') / 1200.0 AS minutes,
         ROW_NUMBER() OVER (PARTITION BY mission ORDER BY json_extract(payload, '$.tick')) AS rn,
         COUNT(*) OVER (PARTITION BY mission) AS n
  FROM events
  WHERE dev = 0 AND type = 'mission_end' AND json_extract(payload, '$.result') = 'victory'
)
SELECT mission, MAX(n) AS wins, ROUND(AVG(minutes), 1) AS median_minutes
FROM wins WHERE rn IN ((n + 1) / 2, (n + 2) / 2)
GROUP BY mission ORDER BY mission;

-- @loss_causes
SELECT mission, json_extract(payload, '$.cause') AS cause, COUNT(*) AS losses
FROM events WHERE dev = 0 AND type = 'mission_end' AND json_extract(payload, '$.result') = 'defeat'
GROUP BY mission, cause ORDER BY losses DESC;

-- @tutorial_funnel
-- GH-345 cut the tutorial from 14 beats to 9 and began sending the beat id.
-- Rows with a NULL id are the old 14-step funnel: read them by step index only
-- (index 0 = take_command ... 13 = command_groups; the list is
-- LEGACY_TUTORIAL_STEP_IDS in src/tutorial-funnel.ts). Never add the two up.
SELECT json_extract(payload, '$.id') AS beat, json_extract(payload, '$.step') AS step,
       json_extract(payload, '$.steps') AS steps, COUNT(DISTINCT player) AS players
FROM events WHERE dev = 0 AND type = 'tutorial_step'
GROUP BY beat, step, steps ORDER BY beat IS NULL, step;

-- @testers
SELECT tester, COUNT(DISTINCT session) AS sessions,
       SUM(CASE WHEN type = 'heartbeat' THEN 1 ELSE 0 END) AS minutes_played,
       datetime(MAX(t) / 1000, 'unixepoch') AS last_seen
FROM events WHERE tester IS NOT NULL
GROUP BY tester ORDER BY last_seen DESC;

-- @feedback (GH-464): open notes per status and kind. Read-only, like every
-- query above. The kill switch is NOT in this file on purpose (the file is run
-- whole); its one-line command is in migrations/0003_feedback.sql.
SELECT status, category, COUNT(*) AS notes,
       SUM(shot_bytes IS NOT NULL) AS with_picture, SUM(replay_bytes IS NOT NULL) AS with_replay,
       SUM(COALESCE(shot_bytes, 0) + COALESCE(replay_bytes, 0)) AS attachment_bytes,
       datetime(MAX(received_at) / 1000, 'unixepoch') AS latest
FROM feedback GROUP BY status, category ORDER BY status, notes DESC;

-- GH-254: rebuild the accounts summary from raw events. Terminal -- run once,
-- by hand, only if 0002_accounts.sql was applied to a database that already
-- held `account` events (i.e. the migration landed after the Worker started
-- receiving them). Not part of normal ingest, which upserts `accounts`
-- itself on every request; this is the recovery path for the gap before that.
INSERT OR REPLACE INTO accounts (player, t, credits, earned, unlocks, tiers, tester, dev)
SELECT e.player, e.t, json_extract(e.payload, '$.credits'), json_extract(e.payload, '$.earned'),
       json_extract(e.payload, '$.unlocks'), json_extract(e.payload, '$.tiers'), e.tester, e.dev
FROM events e
WHERE e.type = 'account'
  AND e.t = (SELECT MAX(t) FROM events x WHERE x.type = 'account' AND x.player = e.player);
