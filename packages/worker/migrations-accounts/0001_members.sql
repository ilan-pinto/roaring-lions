-- GH-1075. Applied to production by the LEAD before merge:
--   npx wrangler d1 migrations apply roaring-lions-accounts --remote
-- D1 enforces foreign keys; the delete path still deletes table by table (§6.4).

CREATE TABLE member (
  id            TEXT PRIMARY KEY,        -- 128 random bits, b64url; never leaves the server
  public_id     TEXT NOT NULL UNIQUE,    -- 8 Crockford base32 chars, shown beside the name
  id_hash       TEXT NOT NULL UNIQUE,    -- sha256(public_id): the tombstone's key (§6.4)
  user_handle   TEXT NOT NULL UNIQUE,    -- WebAuthn user.id: 16 random bytes, b64url
  created_at    INTEGER NOT NULL,
  last_seen_day INTEGER NOT NULL         -- floor(epoch ms / 86,400,000); retention (§6.3)
);

-- One row per way in (§1.3). A provider listed in the CHECK is added by code, never a migration.
CREATE TABLE member_identity (
  id            TEXT PRIMARY KEY,        -- 128 random bits, b64url; the route handle (DELETE identity/:id)
  member_id     TEXT NOT NULL REFERENCES member (id) ON DELETE CASCADE,
  provider      TEXT NOT NULL CHECK (provider IN ('passkey', 'recovery', 'steam')),  -- A5 email, A6 OAuth: a rebuild in their phase
  subject       TEXT NOT NULL,           -- passkey: credential id; recovery: sha256(code); steam: SteamID64, decimal
  state         TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'pending')),  -- pending: a recovery code not yet confirmed (§1.6)
  public_key    BLOB,                    -- passkey only: COSE key
  sign_count    INTEGER NOT NULL DEFAULT 0,   -- passkey only
  transports    TEXT,                    -- passkey only: JSON array, as the browser reported it
  backed_up     INTEGER NOT NULL DEFAULT 0,   -- passkey only: the BS flag, a synced passkey
  label         TEXT,                    -- optional, typed by the player ("Laptop"); cleaned like a callsign
  created_at    INTEGER NOT NULL,
  last_used_day INTEGER,
  UNIQUE (provider, subject),            -- a SteamID or a passkey belongs to one member
  CHECK (state = 'active' OR provider = 'recovery')
);
CREATE INDEX member_identity_member ON member_identity (member_id);
-- At most one active and one pending recovery code, and at most one SteamID, per member.
CREATE UNIQUE INDEX member_identity_one_recovery ON member_identity (member_id, state) WHERE provider = 'recovery';
CREATE UNIQUE INDEX member_identity_one_steam ON member_identity (member_id) WHERE provider = 'steam';

CREATE TABLE session (
  token_hash    TEXT PRIMARY KEY,        -- sha256 of the cookie value; the value itself is never stored
  member_id     TEXT NOT NULL REFERENCES member (id) ON DELETE CASCADE,
  created_at    INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL,        -- sliding, 30 days
  absolute_at   INTEGER NOT NULL,        -- created_at + 180 days
  fresh_until   INTEGER NOT NULL,        -- re-auth window (§1.7)
  last_seen_day INTEGER NOT NULL
);
CREATE INDEX session_member ON session (member_id);

CREATE TABLE auth_challenge (
  challenge_hash TEXT PRIMARY KEY,
  purpose        TEXT NOT NULL CHECK (purpose IN ('register', 'login', 'reauth', 'add', 'steam-login', 'steam-link')),
  member_id      TEXT,                   -- set for 'reauth', 'add' and 'steam-link'
  pre_hash       TEXT,                   -- steam-*: sha256 of the __Host-rl_pre cookie (§1.5)
  expires_at     INTEGER NOT NULL
) WITHOUT ROWID;

CREATE TABLE profile (
  member_id     TEXT PRIMARY KEY REFERENCES member (id) ON DELETE CASCADE,
  display_name  TEXT NOT NULL,           -- 3-20 code points, the callsign cleaner (§5.3)
  show_record   INTEGER NOT NULL DEFAULT 0,   -- opponents see W-L only when 1 (L11)
  updated_at    INTEGER NOT NULL
);

-- The coins. One row, so a spend is one row written; the journal below is the history.
CREATE TABLE wallet (
  member_id     TEXT PRIMARY KEY REFERENCES member (id) ON DELETE CASCADE,
  free          INTEGER NOT NULL DEFAULT 0 CHECK (free BETWEEN 0 AND 1000000),   -- MAX_COINS
  paid          INTEGER NOT NULL DEFAULT 0 CHECK (paid = 0),   -- ST7 rebuilds this table to lift it
  earn          TEXT NOT NULL,           -- EarnRecord JSON: welcomed, campaignDone, backfilled, missions; reset-free empties it
  earn_lifetime TEXT NOT NULL,           -- the claim record (§3.2): every win and star ever credited; NOTHING lowers it
  entitlements  TEXT NOT NULL,           -- RoarWallet.entitlements JSON
  revision      INTEGER NOT NULL DEFAULT 0,
  updated_at    INTEGER NOT NULL
);

-- Append-only. wallet.free = SUM(free_delta) for the member, always (test A2-8).
CREATE TABLE coin_journal (
  id            INTEGER PRIMARY KEY,
  member_id     TEXT NOT NULL REFERENCES member (id) ON DELETE CASCADE,
  at            INTEGER NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('earn', 'backfill', 'claim', 'coupon', 'unit', 'tier', 'reset')),
  free_delta    INTEGER NOT NULL,
  paid_delta    INTEGER NOT NULL DEFAULT 0 CHECK (paid_delta = 0),
  detail        TEXT NOT NULL,           -- JSON: source, missionId, unitId, track, tier, couponIds, credits
  op_id         TEXT NOT NULL
);
CREATE INDEX coin_journal_member ON coin_journal (member_id, id);

CREATE TABLE coupon_use (
  member_id     TEXT NOT NULL REFERENCES member (id) ON DELETE CASCADE,
  coupon_id     TEXT NOT NULL,
  at            INTEGER NOT NULL,
  PRIMARY KEY (member_id, coupon_id)     -- once per member, ever: a brigade reset does not reopen it
) WITHOUT ROWID;

-- The active campaign: the three keys a slot carries, as the client wrote them (trusted, §2.4).
CREATE TABLE campaign_state (
  member_id     TEXT PRIMARY KEY REFERENCES member (id) ON DELETE CASCADE,
  ledger        TEXT NOT NULL,           -- CampaignLedger JSON, through sanitiseLedger
  brigade       TEXT NOT NULL,           -- BrigadeAccount JSON, through migrateAccount
  tutorial_done INTEGER NOT NULL DEFAULT 0,
  bytes         INTEGER NOT NULL CHECK (bytes <= 262144),
  revision      INTEGER NOT NULL DEFAULT 0,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE save_slot (
  member_id     TEXT NOT NULL REFERENCES member (id) ON DELETE CASCADE,
  slot_id       TEXT NOT NULL,
  name          TEXT NOT NULL,
  saved_at      INTEGER NOT NULL,
  build         TEXT NOT NULL,
  origin        TEXT NOT NULL DEFAULT 'player' CHECK (origin IN ('player', 'claim', 'conflict')),
  body          TEXT NOT NULL,           -- SaveSlot JSON, through importSlot's validation
  bytes         INTEGER NOT NULL CHECK (bytes <= 262144),
  PRIMARY KEY (member_id, slot_id)       -- at most 12 'player' and, apart from them, 4 'claim'/'conflict' per member (§2.7)
) WITHOUT ROWID;

CREATE TABLE device_claim (
  member_id     TEXT NOT NULL REFERENCES member (id) ON DELETE CASCADE,
  device_id     TEXT NOT NULL,           -- random, minted by the client at claim time
  at            INTEGER NOT NULL,
  result        TEXT NOT NULL,           -- JSON: coins credited, entitlements carried and not, slots made
  PRIMARY KEY (member_id, device_id)
) WITHOUT ROWID;

-- Idempotency: a write carries a client op id; a retry gets the first answer back.
-- The three routes that issue a recovery code take no op id and never write here (§1.6, §2.5).
CREATE TABLE account_op (
  member_id     TEXT NOT NULL REFERENCES member (id) ON DELETE CASCADE,
  op_id         TEXT NOT NULL,
  kind          TEXT NOT NULL,
  at            INTEGER NOT NULL,        -- swept after 30 days
  response      TEXT NOT NULL,
  PRIMARY KEY (member_id, op_id)
) WITHOUT ROWID;

-- Versus records (§5). Written by the MatchRoom only when at least one seat is a member.
CREATE TABLE match_record (
  code          TEXT NOT NULL,
  started_at    INTEGER NOT NULL,
  ended_at      INTEGER NOT NULL,
  map           TEXT NOT NULL,
  matchup       TEXT NOT NULL,
  win_mode      TEXT,                    -- @lions/net WIN_MODES, NULL for annihilation
  kit           TEXT NOT NULL,
  reason        TEXT NOT NULL,           -- @lions/net's ended/outcome reason, validated at write
  winner_seat   INTEGER CHECK (winner_seat IN (0, 1)),   -- NULL: a draw or a void
  ticks         INTEGER NOT NULL,
  build         TEXT NOT NULL,
  agreed        INTEGER NOT NULL CHECK (agreed IN (0, 1)),  -- 1: both seats agreed, or the room decided it
  PRIMARY KEY (code, started_at)
) WITHOUT ROWID;

CREATE TABLE match_seat (
  code          TEXT NOT NULL,
  started_at    INTEGER NOT NULL,
  seat          INTEGER NOT NULL CHECK (seat IN (0, 1)),
  member_id     TEXT REFERENCES member (id) ON DELETE SET NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('member', 'guest', 'bot', 'deleted')),
  side          TEXT NOT NULL,           -- the faction
  bot_label     TEXT,                    -- a bot preset's label (arena), never text a person typed
  PRIMARY KEY (code, started_at, seat)
) WITHOUT ROWID;
CREATE INDEX match_seat_member ON match_seat (member_id, started_at);

-- No tombstone table. A tombstone lives in Workers KV (ACCOUNT_TOMBSTONES), outside the
-- database a Time Travel restore rewinds: key 'tomb:' + member.id_hash, 90-day TTL (§6.4).

-- The lead's switches, as in the telemetry database. A missing 'accounts' row means CLOSED.
CREATE TABLE flags (name TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL);

-- Per-day counters, the shape of the telemetry database's 0005_write_budgets.sql. It lives in THIS database
-- (plan ruling 0.8), keyed by scope, so the account budgets (acct-new-ip, acct-ops, ...) never touch telemetry's.
-- It has no member_id: the delete path does not map it, and rows older than yesterday are swept daily.
CREATE TABLE rate_day (
  scope TEXT NOT NULL,
  key TEXT NOT NULL,
  day INTEGER NOT NULL,           -- floor(epoch ms / 86,400,000)
  n INTEGER NOT NULL,
  PRIMARY KEY (scope, key, day)
) WITHOUT ROWID;
