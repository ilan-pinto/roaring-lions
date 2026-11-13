/** Every accounts table that holds a member, once (GH-1075 spec §6.2, §6.4, §7). Export and delete are driven
 *  from this list, and test A1-8 reads the migration and fails if a table with a `member_id` column is missing.
 *
 *  `MEMBER_TABLES` is in CHILD-FIRST delete order with `member` last. Every statement takes the member id as ?1.
 *  `exportSql` is null where the table is never exported (a transient challenge; an idempotency cache). */
export interface MemberTable {
  table: string;
  key: 'id' | 'member_id';
  exportSql: string | null;
  deleteSql: string;
}

const del = (table: string): string => `DELETE FROM ${table} WHERE member_id = ?1`;

export const MEMBER_TABLES: readonly MemberTable[] = [
  {
    table: 'account_op', key: 'member_id', exportSql: null, deleteSql: del('account_op'),
  },
  {
    table: 'device_claim', key: 'member_id', deleteSql: del('device_claim'),
    exportSql: 'SELECT device_id, at, result FROM device_claim WHERE member_id = ?1 ORDER BY at',
  },
  {
    table: 'save_slot', key: 'member_id', deleteSql: del('save_slot'),
    exportSql: 'SELECT slot_id, name, saved_at, build, origin, body FROM save_slot WHERE member_id = ?1 ORDER BY slot_id',
  },
  {
    table: 'campaign_state', key: 'member_id', deleteSql: del('campaign_state'),
    exportSql: 'SELECT ledger, brigade, tutorial_done, revision, updated_at FROM campaign_state WHERE member_id = ?1',
  },
  {
    table: 'coupon_use', key: 'member_id', deleteSql: del('coupon_use'),
    exportSql: 'SELECT coupon_id, at FROM coupon_use WHERE member_id = ?1 ORDER BY at',
  },
  {
    table: 'coin_journal', key: 'member_id', deleteSql: del('coin_journal'),
    exportSql: 'SELECT id, at, kind, free_delta, paid_delta, detail, op_id FROM coin_journal WHERE member_id = ?1 ORDER BY id',
  },
  {
    table: 'wallet', key: 'member_id', deleteSql: del('wallet'),
    exportSql: 'SELECT free, paid, earn, earn_lifetime, entitlements, revision, updated_at FROM wallet WHERE member_id = ?1',
  },
  {
    table: 'profile', key: 'member_id', deleteSql: del('profile'),
    exportSql: 'SELECT display_name, show_record, updated_at FROM profile WHERE member_id = ?1',
  },
  // A challenge lives five minutes and is never exported; member_id is nullable, so a row can have none.
  {
    table: 'auth_challenge', key: 'member_id', exportSql: null, deleteSql: del('auth_challenge'),
  },
  {
    table: 'session', key: 'member_id', deleteSql: del('session'),
    // Created and last-seen DAYS only: never the token hash (§6.2).
    exportSql: 'SELECT created_at / 86400000 AS created_day, last_seen_day FROM session WHERE member_id = ?1 ORDER BY created_at',
  },
  {
    table: 'member_identity', key: 'member_id', deleteSql: del('member_identity'),
    // Metadata only: a SteamID or Google sub in full (the player's own), never key bytes or a code hash (§6.2).
    exportSql: `SELECT provider, label, created_at, last_used_day, backed_up, state,
  CASE WHEN provider = 'steam' THEN subject END AS steam_id,
  CASE WHEN provider = 'google' THEN subject END AS google_sub
FROM member_identity WHERE member_id = ?1 ORDER BY created_at`,
  },
  {
    // The seat survives as an anonymous row (the opponent's record is theirs); the sweep below drops a record with no member seat left.
    table: 'match_seat', key: 'member_id',
    deleteSql: "UPDATE match_seat SET member_id = NULL, kind = 'deleted' WHERE member_id = ?1",
    exportSql: `SELECT r.code, r.started_at, r.ended_at, r.map, r.matchup, r.win_mode, r.kit, r.reason, r.winner_seat,
  r.ticks, r.build, r.agreed, s.seat, s.side
FROM match_seat s JOIN match_record r ON r.code = s.code AND r.started_at = s.started_at
WHERE s.member_id = ?1 ORDER BY r.started_at`,
  },
  {
    table: 'member', key: 'id', deleteSql: 'DELETE FROM member WHERE id = ?1',
    exportSql: 'SELECT public_id, created_at, last_seen_day FROM member WHERE id = ?1',
  },
];

/** Run right after `match_seat`'s delete and before `member`'s, in the same batch. Takes NO bound parameter.
 *  Not a MEMBER_TABLES row: `match_record` has no `member_id` (test A1-8 excludes it by name). */
export const MATCH_ORPHAN_SWEEP_SQL =
  "DELETE FROM match_record WHERE NOT EXISTS (SELECT 1 FROM match_seat s WHERE s.code = match_record.code AND s.started_at = match_record.started_at AND s.kind = 'member')";

export const RATE_DAY_SQL = "DELETE FROM rate_day WHERE scope IN ('acct-ops', 'acct-claim') AND key = ?1";

/** The whole delete batch in order: each table's delete (member id as ?1), the orphan sweep after `match_seat`. */
export function deleteStatements(): { sql: string; bindsMember: boolean }[] {
  const out: { sql: string; bindsMember: boolean }[] = [];
  for (const t of MEMBER_TABLES) {
    // The per-member day budget is keyed by the internal member id (limits.ts opBudget): no row may outlive its member.
    if (t.table === 'member') out.push({ sql: RATE_DAY_SQL, bindsMember: true });
    out.push({ sql: t.deleteSql, bindsMember: true });
    if (t.table === 'match_seat') out.push({ sql: MATCH_ORPHAN_SWEEP_SQL, bindsMember: false });
  }
  return out;
}
