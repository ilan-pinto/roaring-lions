-- GH-1075 G1. Applied to production by the LEAD before the PR merges (merging deploys):
--   npx wrangler d1 migrations apply roaring-lions-accounts --remote
-- Adds the 'google' provider and the 'google-login' / 'google-link' purposes. SQLite cannot widen a CHECK in place, so
-- member_identity is rebuilt (every row copied) and auth_challenge, which holds only 5-minute rows, is dropped and recreated.
-- D1 keeps foreign keys on and the page says a migration cannot switch them off, so the documented way is used:
-- defer_foreign_keys (checked at commit). member_identity references member and nothing references it.
PRAGMA defer_foreign_keys = true;

CREATE TABLE member_identity_new (
  id            TEXT PRIMARY KEY,        -- 128 random bits, b64url; the route handle (DELETE identity/:id)
  member_id     TEXT NOT NULL REFERENCES member (id) ON DELETE CASCADE,
  provider      TEXT NOT NULL CHECK (provider IN ('passkey', 'recovery', 'steam', 'google')),
  subject       TEXT NOT NULL,           -- passkey: credential id; recovery: sha256(code); steam: SteamID64, decimal; google: the ID token's sub
  state         TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'pending')),  -- pending: a recovery code not yet confirmed (§1.6)
  public_key    BLOB,                    -- passkey only: COSE key
  sign_count    INTEGER NOT NULL DEFAULT 0,   -- passkey only
  transports    TEXT,                    -- passkey only: JSON array, as the browser reported it
  backed_up     INTEGER NOT NULL DEFAULT 0,   -- passkey only: the BS flag, a synced passkey
  label         TEXT,                    -- optional, typed by the player ("Laptop"); cleaned like a callsign
  created_at    INTEGER NOT NULL,
  last_used_day INTEGER,
  UNIQUE (provider, subject),            -- a SteamID, a Google account or a passkey belongs to one member
  CHECK (state = 'active' OR provider = 'recovery')
);
INSERT INTO member_identity_new (id, member_id, provider, subject, state, public_key, sign_count, transports, backed_up, label, created_at, last_used_day)
  SELECT id, member_id, provider, subject, state, public_key, sign_count, transports, backed_up, label, created_at, last_used_day FROM member_identity;
DROP TABLE member_identity;
ALTER TABLE member_identity_new RENAME TO member_identity;
CREATE INDEX member_identity_member ON member_identity (member_id);
CREATE UNIQUE INDEX member_identity_one_recovery ON member_identity (member_id, state) WHERE provider = 'recovery';
CREATE UNIQUE INDEX member_identity_one_steam ON member_identity (member_id) WHERE provider = 'steam';
CREATE UNIQUE INDEX member_identity_one_google ON member_identity (member_id) WHERE provider = 'google';

DROP TABLE auth_challenge;
CREATE TABLE auth_challenge (
  challenge_hash TEXT PRIMARY KEY,
  purpose        TEXT NOT NULL CHECK (purpose IN ('register', 'login', 'reauth', 'add', 'steam-login', 'steam-link', 'google-login', 'google-link')),
  member_id      TEXT,                   -- set for 'reauth', 'add', 'steam-link' and 'google-link'
  pre_hash       TEXT,                   -- steam-*, google-*: sha256 of the __Host-rl_pre cookie
  expires_at     INTEGER NOT NULL
) WITHOUT ROWID;
