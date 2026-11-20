-- GH-1414: desktop crash reports (POST /api/crash, packages/worker/src/crash-ingest.ts). One row per report the
-- packaged desktop build's main process sends; the body is the record of data/schemas/crash_report.schema.json,
-- validated by crash-meta.ts before it is stored. No IP, no player id, no free text: `launch` is a random id that lives
-- for one launch of the game, and `stack` is a JSON array of frames whose locations are inside the game's own files.
-- Rows older than CRASH_RETENTION_MS (90 days) are deleted on the ingest path (crash-ingest.ts), not by the daily cron.
--
-- NOT APPLIED ANYWHERE by the change that adds it. The lead applies it before opening the `crash` flag:
--   npx wrangler d1 migrations apply roaring-lions-telemetry --remote
-- Numbered 0008: 0007 is taken by an open branch (cl/privacy-form, 0007_feedback_privacy.sql); the runner orders by
-- name, so the gap is harmless.
--
-- The kill switch is the `flags` row `crash` (0003_feedback.sql's table). Reports are refused (410) unless it reads
-- 'open'; NO row means closed. Open it, and close it again, by hand:
--   npx wrangler d1 execute roaring-lions-telemetry --remote --command \
--     "INSERT INTO flags (name, value, updated_at) VALUES ('crash', 'open', unixepoch() * 1000)
--      ON CONFLICT (name) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
-- (value 'closed' to close). The env half, CRASH_CLOSED (a Worker secret), closes it with no database at all.
CREATE TABLE crash_report (
  id INTEGER PRIMARY KEY,
  received_at INTEGER NOT NULL,
  t INTEGER NOT NULL,                 -- client epoch ms
  kind TEXT NOT NULL CHECK (kind IN ('renderer_gone','child_gone','main_exception','main_rejection','page_exception','page_rejection')),
  launch TEXT NOT NULL,
  uptime_s INTEGER NOT NULL,
  version TEXT NOT NULL,
  "commit" TEXT,
  electron TEXT NOT NULL,
  chrome TEXT,
  platform TEXT NOT NULL,
  arch TEXT NOT NULL,
  gpu TEXT NOT NULL,
  screen TEXT,
  mission TEXT,
  reason TEXT,
  exit_code INTEGER,
  process TEXT,
  service TEXT,
  name TEXT,
  message TEXT,
  stack TEXT                          -- JSON array of frames, or NULL
);
CREATE INDEX crash_report_received ON crash_report (received_at);
CREATE INDEX crash_report_launch ON crash_report (launch, received_at);
