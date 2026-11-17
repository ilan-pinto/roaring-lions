-- GH-695 S1 (spec 2026-11-14-admin-account-page-design.md, D9). Applied to production by the LEAD before the PR merges
-- (merging deploys):
--   npx wrangler d1 migrations apply roaring-lions-accounts --remote
-- 1. coin_journal gains the 'admin' kind. SQLite cannot widen a CHECK in place, so the table is rebuilt exactly as in
--    0002_google.sql: defer_foreign_keys (checked at commit), copy EVERY row with its id, drop, rename, re-index. Nothing
--    references coin_journal, ids and values are copied verbatim (so ORDER BY id and wallet.free = SUM(free_delta) hold).
-- 2. admin_member: who may WRITE from /stats/members (D1). Empty until the lead adds his own row by hand.
-- 3. admin_action: the append-only audit of what an admin viewed or changed (D9, D14).
PRAGMA defer_foreign_keys = true;

CREATE TABLE coin_journal_new (
  id            INTEGER PRIMARY KEY,
  member_id     TEXT NOT NULL REFERENCES member (id) ON DELETE CASCADE,
  at            INTEGER NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('earn', 'backfill', 'claim', 'coupon', 'unit', 'tier', 'reset', 'admin')),
  free_delta    INTEGER NOT NULL,
  paid_delta    INTEGER NOT NULL DEFAULT 0 CHECK (paid_delta = 0),
  detail        TEXT NOT NULL,           -- JSON: source, missionId, unitId, track, tier, couponIds, credits; admin: mode, reason, before, after, by
  op_id         TEXT NOT NULL
);
INSERT INTO coin_journal_new (id, member_id, at, kind, free_delta, paid_delta, detail, op_id)
  SELECT id, member_id, at, kind, free_delta, paid_delta, detail, op_id FROM coin_journal;
DROP TABLE coin_journal;
ALTER TABLE coin_journal_new RENAME TO coin_journal;
CREATE INDEX coin_journal_member ON coin_journal (member_id, id);

CREATE TABLE admin_member (
  member_id     TEXT PRIMARY KEY REFERENCES member (id) ON DELETE CASCADE,
  added_at      INTEGER NOT NULL
);

-- Append-only. admin_id goes NULL when the admin's own account is deleted (the action stays with its member);
-- member_id is NULL for a row about the switch, which is about no member.
CREATE TABLE admin_action (
  id            INTEGER PRIMARY KEY,
  at            INTEGER NOT NULL,
  admin_id      TEXT REFERENCES member (id) ON DELETE SET NULL,
  member_id     TEXT REFERENCES member (id) ON DELETE CASCADE,
  action        TEXT NOT NULL CHECK (action IN ('coins', 'credits', 'switch', 'view')),
  mode          TEXT CHECK (mode IN ('grant', 'deduct', 'set')),
  delta         INTEGER,
  before        INTEGER,
  after         INTEGER,
  reason        TEXT,
  op_id         TEXT
);
CREATE INDEX admin_action_member ON admin_action (member_id, id);
CREATE INDEX admin_action_at ON admin_action (at);
