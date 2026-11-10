/**
 * The wallet's one writer (GH-1075 A2). Only this file contains `UPDATE wallet` or `INSERT INTO coin_journal`
 * (test A2-27). D1 has no row-level compare-and-swap, so a write guards on the revision it read through the schema's
 * own CHECK (§0.6): a stale write sets `free = -1`, the CHECK fails, and D1 rolls the whole batch back. The journal
 * rows are built from the same read, so `wallet.free = SUM(free_delta)` by construction.
 */
import {
  RECEIPT_CAP,
  ROAR_VERSION,
  migrateRoar,
  type EarnRecord,
  type RoarReceipt,
  type RoarWallet,
  type WalletView,
} from '@lions/economy';
import type { D1Like, D1Stmt } from '../d1';

/** The kinds `coin_journal`'s CHECK allows. */
export type JournalKind = 'earn' | 'backfill' | 'claim' | 'coupon' | 'unit' | 'tier' | 'reset';

export interface WalletRow {
  memberId: string;
  free: number;
  paid: number;
  earn: EarnRecord;
  earnLifetime: EarnRecord;
  entitlements: RoarWallet['entitlements'];
  revision: number;
}

export interface JournalEntry {
  kind: JournalKind;
  delta: number;
  receipt: RoarReceipt | null;
  detail: Record<string, unknown>;
  opId: string;
  at: number;
}

interface WalletSql {
  free: number;
  paid: number;
  earn: string;
  earn_lifetime: string;
  entitlements: string;
  revision: number;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

export async function readWallet(db: D1Like, memberId: string): Promise<WalletRow> {
  const r = await db
    .prepare('SELECT free, paid, earn, earn_lifetime, entitlements, revision FROM wallet WHERE member_id = ?1')
    .bind(memberId)
    .first<WalletSql>();
  if (r === null) throw new Error('member has no wallet');
  // migrateRoar is the one tolerant reader of an EarnRecord and of the entitlements.
  const w = migrateRoar({ entitlements: parseJson(r.entitlements), earn: parseJson(r.earn) });
  const lifetime = migrateRoar({ earn: parseJson(r.earn_lifetime) });
  return {
    memberId,
    free: r.free,
    paid: r.paid,
    earn: w.earn,
    earnLifetime: lifetime.earn,
    entitlements: w.entitlements,
    revision: r.revision,
  };
}

export function asRoar(w: WalletRow, receipts: RoarReceipt[]): RoarWallet {
  return {
    version: ROAR_VERSION,
    coins: { free: w.free, paid: 0 },
    entitlements: w.entitlements,
    earn: w.earn,
    receipts,
  };
}

/**
 * The guarded `UPDATE wallet` (§0.6) and one journal insert per entry. THROWS (a programming error, never a 409)
 * when the entries' deltas do not sum to the wallet's change, an empty list for a wallet that moved included, or when
 * the new balance would leave the wallet's range.
 */
export function walletWrite(
  db: D1Like,
  before: WalletRow,
  after: { roar: RoarWallet; earnLifetime: EarnRecord },
  j: JournalEntry[],
): D1Stmt[] {
  const free = after.roar.coins.free;
  if (after.roar.coins.paid !== 0) throw new Error('walletWrite: paid must stay 0');
  if (!Number.isInteger(free)) throw new Error('walletWrite: free is not an integer');
  const moved = free - before.free;
  const sum = j.reduce((n, e) => n + e.delta, 0);
  if (sum !== moved) throw new Error(`walletWrite: journal sums to ${sum}, the wallet moved ${moved}`);
  // A balance outside 0..MAX_COINS is left to the schema's CHECK on purpose: budgetedOp answers it 500, not 409.
  const update = db
    .prepare(
      `UPDATE wallet SET
         free = CASE WHEN revision = ?2 THEN ?3 ELSE -1 END,
         earn = ?4, earn_lifetime = ?5, entitlements = ?6,
         updated_at = COALESCE(?7, updated_at), revision = revision + 1
       WHERE member_id = ?1`,
    )
    .bind(
      before.memberId,
      before.revision,
      free,
      JSON.stringify(after.roar.earn),
      JSON.stringify(after.earnLifetime),
      JSON.stringify(after.roar.entitlements),
      j.length > 0 ? (j[j.length - 1]?.at ?? null) : null,
    );
  const inserts = j.map((e) =>
    db
      .prepare(
        `INSERT INTO coin_journal (member_id, at, kind, free_delta, paid_delta, detail, op_id)
         VALUES (?1, ?2, ?3, ?4, 0, ?5, ?6)`,
      )
      .bind(before.memberId, e.at, e.kind, e.delta, JSON.stringify({ ...e.detail, receipt: e.receipt }), e.opId),
  );
  return [update, ...inserts];
}

/** The member's last `RECEIPT_CAP` receipts, oldest first (§0.4). */
export async function receiptsOf(db: D1Like, memberId: string): Promise<RoarReceipt[]> {
  const rows = await db
    .prepare(
      `SELECT json_extract(detail, '$.receipt') AS r FROM coin_journal
       WHERE member_id = ?1 AND json_extract(detail, '$.receipt') IS NOT NULL ORDER BY id DESC LIMIT ?2`,
    )
    .bind(memberId, RECEIPT_CAP)
    .all<{ r: string }>();
  const out: RoarReceipt[] = [];
  for (const row of rows.results) {
    const v = parseJson(row.r);
    if (v !== null) out.push(v as RoarReceipt);
  }
  return out.reverse();
}

export async function walletView(db: D1Like, memberId: string): Promise<WalletView> {
  const w = await readWallet(db, memberId);
  return { free: w.free, paid: 0, entitlements: w.entitlements, earn: w.earn, receipts: await receiptsOf(db, memberId), revision: w.revision };
}

export const isCasFailure = (err: unknown): boolean => /CHECK constraint failed/i.test(err instanceof Error ? err.message : String(err));
export const isCapFailure = (err: unknown): boolean =>
  /NOT NULL constraint failed: member\.last_seen_day/i.test(err instanceof Error ? err.message : String(err));
/** The claim's device guard trips a different NOT NULL column, so a slot-cap trip is never reported as `claim_cap`. */
export const isDeviceCapFailure = (err: unknown): boolean =>
  /NOT NULL constraint failed: member\.created_at/i.test(err instanceof Error ? err.message : String(err));

/**
 * The count guard of §0.36: the LAST statement before the op insert in any batch that adds a slot or a
 * `device_claim` row. `countSql` is a `SELECT COUNT(*)` that takes the member id as `?1`. Past `cap` it sets
 * `member.last_seen_day` to NULL, which trips its NOT NULL and rolls the batch back (`isCapFailure`). The claim's device
 * guard passes `created_at` instead (`isDeviceCapFailure`), so the two caps answer differently.
 */
export function capGuard(db: D1Like, memberId: string, countSql: string, cap: number, column: 'last_seen_day' | 'created_at' = 'last_seen_day'): D1Stmt {
  return db
    .prepare(`UPDATE member SET ${column} = CASE WHEN (${countSql}) <= ?2 THEN ${column} ELSE NULL END WHERE id = ?1`)
    .bind(memberId, cap);
}
