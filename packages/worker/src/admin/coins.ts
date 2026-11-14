/**
 * POST /stats/api/members/:publicId/coins (GH-695 S4, spec D7, D9, D10). The server computes the delta; the client
 * sends a mode (grant, deduct, set), an amount, a reason, the wallet revision its card showed and an op id. Everything
 * below is refused BEFORE any write; a write is ONE batch: the balance (`walletWrite`, the wallet's only writer), its
 * `coin_journal` row of kind 'admin', the `admin_action` audit row, the day counters and the `account_op` row.
 */
import { MAX_COINS } from '@lions/economy';
import type { D1Like, D1Stmt, Env } from '../d1';
import { asRoar, isCapFailure, isCasFailure, readWallet, walletWrite, type JournalEntry, type WalletRow } from '../account/coin';
import { CAS_TRIES } from '../account/config';
import { OpReject, validOpId, withOp } from '../account/op';
import { sessionJson } from '../account/session';
import { countToday, dayOf } from '../rate-day';
import { adminActionInsert } from './admin-write';
import { ADMIN_COINS_GRANTED_PER_DAY, ADMIN_COINS_PER_ACTION, ADMIN_WRITES_PER_DAY, REASON_MAX, REASON_MIN } from './config';
import { adminWriteGate, readAdminBody } from './gate';

type Mode = 'grant' | 'deduct' | 'set';
const MODES: readonly string[] = ['grant', 'deduct', 'set'];

const TO_SPACE = /[\p{Cc}\u2028\u2029]/gu;
const DROP = /[\p{Cf}\p{Co}\p{Cs}]/gu;
const strip = (s: string): string => s.replace(TO_SPACE, ' ').replace(DROP, '');

/** Cleaned like a callsign (control characters to a space, format characters dropped, NFKC, one space), uncapped:
 *  the length is judged by the caller, never truncated. */
export function cleanReason(raw: string): string {
  return strip(strip(raw).normalize('NFKC')).replace(/\s+/gu, ' ').trim();
}

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

/**
 * D10 inside the batch: run AFTER the day-counter upserts, it nulls a NOT NULL column (`member.last_seen_day`, which
 * `isCapFailure` reads, never a CHECK) when a counter now stands above its cap, so the whole batch rolls back, the
 * counter's own add included. The pre-checks in `build` only save a write; this is what makes the caps exact when
 * two writes to different members race.
 */
function dayGuard(db: D1Like, memberId: string, now: number, caps: [scope: string, cap: number][]): D1Stmt {
  const over = caps.map(() => '').map((_, i) => `COALESCE((SELECT n FROM rate_day WHERE scope = ?${2 + i * 2} AND key = '' AND day = ?${2 + caps.length * 2}), 0) > ?${3 + i * 2}`).join(' OR ');
  return db
    .prepare(`UPDATE member SET last_seen_day = CASE WHEN (${over}) THEN NULL ELSE last_seen_day END WHERE id = ?1`)
    .bind(memberId, ...caps.flatMap(([scope, cap]) => [scope, cap]), dayOf(now));
}

/** An upsert that adds `by` to a day counter, in the same batch as the write it counts (so a rolled-back write counts nothing). */
function dayAdd(db: D1Like, scope: string, now: number, by: number): D1Stmt {
  return db
    .prepare(
      `INSERT INTO rate_day (scope, key, day, n) VALUES (?1, '', ?2, ?3)
       ON CONFLICT (scope, key, day) DO UPDATE SET n = n + excluded.n`,
    )
    .bind(scope, dayOf(now), by);
}

export async function coinsRoute(req: Request, env: Env, publicId: string, now: number): Promise<Response> {
  // countsToDay is false: the day counter is charged inside the batch, so a refusal or a replay spends nothing.
  const w = await adminWriteGate(req, env, now, { requireOpen: true, countsToDay: false });
  if (w instanceof Response) return w;
  const { db, adminId, setCookie } = w;
  const body = await readAdminBody(req, setCookie);
  if (body instanceof Response) return body;
  const bad = (error: string) => sessionJson(400, { error }, setCookie);

  const { op_id: opId, mode, amount, reason: rawReason, revision } = body;
  if (!validOpId(opId)) return bad('op_id');
  if (typeof mode !== 'string' || !MODES.includes(mode)) return bad('mode');
  if (!isInt(amount) || amount < 0) return bad('amount'); // a `set` past MAX_COINS is a 409 range, below
  if (mode !== 'set' && (amount < 1 || amount > ADMIN_COINS_PER_ACTION)) return bad('amount');
  if (!isInt(revision) || revision < 0) return bad('revision');
  if (typeof rawReason !== 'string') return bad('reason');
  const reason = cleanReason(rawReason);
  const chars = [...reason].length;
  if (chars < REASON_MIN || chars > REASON_MAX) return bad('reason');

  const m = await db.prepare('SELECT id FROM member WHERE public_id = ?1').bind(publicId).first<{ id: string }>();
  if (m === null) return sessionJson(404, { error: 'not_found' }, setCookie);

  const build = async () => {
    let wallet: WalletRow;
    try {
      wallet = await readWallet(db, m.id);
    } catch {
      throw new OpReject(404, { error: 'no_wallet' });
    }
    // D9.2: the admin's expected revision is judged first, so a retry never applies a change on a balance the admin did not see.
    if (wallet.revision !== revision) throw new OpReject(409, { error: 'moved', wallet: { free: wallet.free, revision: wallet.revision } });
    const m0 = mode as Mode;
    const after = m0 === 'grant' ? wallet.free + amount : m0 === 'deduct' ? wallet.free - amount : amount;
    // D7.2: outside the range is refused here; a CHECK trip is reserved for the revision guard (`isCasFailure` cannot tell them apart).
    if (after < 0 || after > MAX_COINS) throw new OpReject(409, { error: 'range' });
    const delta = after - wallet.free;
    if (delta === 0) throw new OpReject(400, { error: 'no_change' });
    if (Math.abs(delta) > ADMIN_COINS_PER_ACTION) throw new OpReject(400, { error: 'amount' });
    // D10: the day caps (global). A write costs one; coins count only when granted.
    if ((await countToday(db, 'admin-writes', '', now)) >= ADMIN_WRITES_PER_DAY) throw new OpReject(429, { error: 'limit' });
    if (delta > 0 && (await countToday(db, 'admin-coins', '', now)) + delta > ADMIN_COINS_GRANTED_PER_DAY) throw new OpReject(429, { error: 'limit' });
    // `by` is the word "admin", never the admin's public id: a member's export copies `detail` verbatim.
    const entry: JournalEntry = { kind: 'admin', delta, receipt: null, detail: { mode: m0, reason, before: wallet.free, after, by: 'admin' }, opId, at: now };
    const roar = asRoar(wallet, []);
    const statements: D1Stmt[] = [
      ...walletWrite(db, wallet, { roar: { ...roar, coins: { free: after, paid: 0 } }, earnLifetime: wallet.earnLifetime }, [entry]),
      adminActionInsert(db, { at: now, adminId, memberId: m.id, action: 'coins', mode: m0, delta, before: wallet.free, after, reason, opId }),
      dayAdd(db, 'admin-writes', now, 1),
    ];
    const caps: [string, number][] = [['admin-writes', ADMIN_WRITES_PER_DAY]];
    if (delta > 0) {
      statements.push(dayAdd(db, 'admin-coins', now, delta));
      caps.push(['admin-coins', ADMIN_COINS_GRANTED_PER_DAY]);
    }
    statements.push(dayGuard(db, m.id, now, caps));
    return { statements, status: 200, response: { wallet: { free: after, revision: wallet.revision + 1, updatedAt: now }, before: wallet.free, after, delta } };
  };

  for (let attempt = 0; attempt < CAS_TRIES; attempt++) {
    try {
      const out = await withOp(db, m.id, opId, 'admin.coins', now, build);
      return sessionJson(out.status, out.body, setCookie);
    } catch (err) {
      if (err instanceof OpReject) return sessionJson(err.status, err.body, setCookie);
      // A lost race: the next attempt re-reads, and the revision check answers 'moved' if the wallet changed.
      if (isCapFailure(err)) return sessionJson(429, { error: 'limit' }, setCookie); // a day cap tripped inside the batch; nothing was written
      if (!isCasFailure(err)) throw err;
    }
  }
  return sessionJson(409, { error: 'busy' }, setCookie);
}
