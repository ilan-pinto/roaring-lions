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
SELECT json_extract(payload, '$.step') AS step, COUNT(DISTINCT player) AS players
FROM events WHERE dev = 0 AND type = 'tutorial_step'
GROUP BY step ORDER BY step;

-- @testers
SELECT tester, COUNT(DISTINCT session) AS sessions,
       SUM(CASE WHEN type = 'heartbeat' THEN 1 ELSE 0 END) AS minutes_played,
       datetime(MAX(t) / 1000, 'unixepoch') AS last_seen
FROM events WHERE tester IS NOT NULL
GROUP BY tester ORDER BY last_seen DESC;
