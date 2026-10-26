-- Snapshot S3 (net sim snapshot design §5.2): a snapshot upload whose two seats
-- disagreed, written by the MatchRoom. One row per room and tick, bounded per room
-- instance and per day in snap-mismatch-log.ts, purged after RETENTION_MS.
-- `kind` is 'sha' (the two seats' inflated bytes differ) or 'digest' (same bytes,
-- the header's match digest differs from the one the seats agreed).
-- Apply before merge: npx wrangler d1 migrations apply roaring-lions-telemetry --remote
CREATE TABLE match_snap_mismatch (
  code       TEXT    NOT NULL,
  tick       INTEGER NOT NULL,
  kind       TEXT    NOT NULL,
  sha_a      TEXT    NOT NULL,
  sha_b      TEXT    NOT NULL,
  digest     INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (code, tick)
);
