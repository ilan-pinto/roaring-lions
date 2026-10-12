-- N1b (network design §3.4): a desync's evidence, written by the MatchRoom.
-- Apply before merge: npx wrangler d1 migrations apply roaring-lions-telemetry --remote
CREATE TABLE match_desync (
  code        TEXT    NOT NULL,
  tick        INTEGER NOT NULL,
  hash_a      INTEGER NOT NULL,
  hash_b      INTEGER NOT NULL,
  config      TEXT    NOT NULL,
  frames      TEXT    NOT NULL,
  frame_count INTEGER NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (code, tick)
);
