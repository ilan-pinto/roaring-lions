/** Deleting an account (GH-1075 A1, spec §6.4). Every step is retryable while the session still exists. */
import { ID_PATTERN } from '@lions/data/telemetry';
import type { D1Like, D1Stmt } from '../d1';
import { ACCOUNT_BODY_MAX_BYTES, TOMB_TTL_S } from './config';
import { accountJson, readAccountBody } from './http';
import { perMinute } from './limits';
import { readCapped } from '../read-capped';
import type { KVLike } from './kv';
import type { AccountCtx } from './routes';
import { clearedSessionCookie, requireSession, sessionJson } from './session';
import { deleteStatements } from './tables';

/** Added to every statement that binds the member. The batch is one transaction, so a sign-in that stamps
 *  `last_seen_day` past the guard either commits first (every guarded statement then deletes nothing) or after
 *  (the identity is gone and the sign-in resolves no member). `member` goes last, so the guard holds throughout. */
const GUARD = ' AND EXISTS (SELECT 1 FROM member WHERE id = ?1 AND last_seen_day <= ?2)';

/** One guarded batch over every member table. `gone` is true when the member row is gone afterwards; `queries` is what it cost:
 *  ONE D1 query when this batch deleted it, two when it deleted nothing (a guard held, or the row was already gone). The route deletes
 *  one member this way; the cron deletes many in one batch (`deleteDueStatements`, GH-1432). */
export async function deleteMemberCounted(db: D1Like, memberId: string, guard: { lastSeenAtMost: number }): Promise<{ gone: boolean; queries: number }> {
  const statements = deleteStatements().map((s) =>
    s.bindsMember ? db.prepare(s.sql + GUARD).bind(memberId, guard.lastSeenAtMost) : db.prepare(s.sql),
  );
  const out = await db.batch(statements);
  // `member` is the last statement and carries the guard, so a change there is the proof the row is gone.
  // D1's batch result carries `meta.changes`; the node:sqlite test double's `run()` result carries `changes`.
  const last = out[out.length - 1] as { meta?: { changes?: number }; changes?: number | bigint } | undefined;
  if (Number(last?.meta?.changes ?? last?.changes ?? 0) > 0) return { gone: true, queries: 1 };
  const left = await db.prepare('SELECT 1 AS one FROM member WHERE id = ?1').bind(memberId).first<{ one: number }>();
  return { gone: left === null, queries: 2 };
}

export async function deleteMember(db: D1Like, memberId: string, guard: { lastSeenAtMost: number }): Promise<boolean> {
  return (await deleteMemberCounted(db, memberId, guard)).gone;
}

/** A member the cron deletes, guarded by its own day: deleted only if `last_seen_day <= day` still holds inside the batch. */
export interface DueMember { id: string; day: number }

/** D1 binds at most 100 values a statement; a due member binds two (its id and its day). */
export const DUE_MEMBERS_MAX = 40;

/** GH-1432: the cron's ONE delete batch for many members at once, the same statements as `deleteMemberCounted` in the same order, each
 *  naming the members through a `due` CTE instead of `= ?1`. A row goes only if its member is still eligible (the guard, per row, inside
 *  the one transaction), so a sign-in racing the batch spares that member whole and nobody else. It costs `deleteStatements().length`
 *  statements however many members it carries. The platform counts the whole batch as ONE D1 query; under this repository's stricter
 *  per-statement meter (`cron-budget.test.ts`) it is 17, and one batch for all is the reason it exists. */
export function deleteDueStatements(db: D1Like, due: readonly DueMember[]): D1Stmt[] {
  if (due.length === 0 || due.length > DUE_MEMBERS_MAX) throw new Error(`a due batch carries 1 to ${DUE_MEMBERS_MAX} members, not ${due.length}`);
  const cte = `WITH due(id, day) AS (VALUES ${due.map((_, i) => `(?${2 * i + 1}, ?${2 * i + 2})`).join(', ')}) `;
  const eligible = 'SELECT m.id FROM member m JOIN due ON due.id = m.id WHERE m.last_seen_day <= due.day';
  const args = due.flatMap((d) => [d.id, d.day]);
  return deleteStatements().map((s) => {
    if (!s.bindsMember) return db.prepare(s.sql);
    if (!s.sql.endsWith(' = ?1')) throw new Error(`a member statement must end in "= ?1": ${s.sql}`);
    return db.prepare(`${cte}${s.sql.slice(0, -' = ?1'.length)} IN (${eligible})`).bind(...args);
  });
}

/** The telemetry database's rows for one player, in one batch. Idempotent; touches no account row. */
export async function deleteTelemetryFor(db: D1Like, player: string): Promise<void> {
  if (!ID_PATTERN.test(player)) throw new Error('bad telemetry player id');
  // The attachments first, explicitly: a row must not outlive its note on a database that does not cascade.
  const sql = [
    'DELETE FROM feedback_picture WHERE feedback_id IN (SELECT id FROM feedback WHERE player = ?1)',
    'DELETE FROM feedback_replay WHERE feedback_id IN (SELECT id FROM feedback WHERE player = ?1)',
    'DELETE FROM events WHERE player = ?1',
    'DELETE FROM event_batch WHERE player = ?1',
    'DELETE FROM players WHERE player = ?1',
    'DELETE FROM accounts WHERE player = ?1',
    'DELETE FROM feedback WHERE player = ?1',
  ];
  await db.batch(sql.map((s) => db.prepare(s).bind(player)));
}

/** Workers KV takes one write a second to a key (a faster one can answer 429), so the route's second write of its tombstone waits this
 *  long after the first, and again before its one retry: the cron's racing delete of the same key may have just taken that second. */
export const TOMB_REWRITE_GAP_MS = 1_100;

const timer = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms); });

/** GH-1534: the tombstone written AGAIN, byte for byte, once the batch has committed. The cron's prune of a "cancelled" tombstone
 *  (`sweep.ts`, the scan and the survivor step) judges the member by a D1 read made BEFORE this batch committed and the tombstone by an
 *  eventually consistent KV read, which may still show the cron's own older one; its delete can then remove the tombstone written above,
 *  leaving a deleted account that a Time Travel restore would not re-delete and `gone` would not report. This later write overwrites
 *  that delete (KV keeps the last write). Two tries, a gap before each; a failure of both is logged and the delete still answers 200:
 *  the rows are gone and the first write stands unless that rare race took it. */
async function rewriteTomb(kv: KVLike, key: string, value: string, sleep: (ms: number) => Promise<void>): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt++) {
    await sleep(TOMB_REWRITE_GAP_MS);
    try {
      await kv.put(key, value, { expirationTtl: TOMB_TTL_S });
      return;
    } catch (err) {
      if (attempt === 1) console.warn('account: tombstone rewrite failed', { error: err instanceof Error ? err.name : typeof err });
    }
  }
}

/** POST delete: a fresh session. Telemetry (if asked), then the tombstone, then the guarded batch, then the tombstone again (GH-1534). */
export async function deleteAccount(ctx: AccountCtx): Promise<Response> {
  const got = await requireSession(ctx, { fresh: true });
  if (got instanceof Response) return got;
  const db = ctx.env.ACCOUNTS;
  const kv = ctx.env.ACCOUNT_TOMBSTONES;
  if (db === undefined || kv === undefined) return accountJson(503, { error: 'accounts are not configured' });
  const { session, setCookie } = got;
  // An empty body is "no options"; a non-empty one that is not JSON is refused, so a ticked telemetry box is never lost.
  const raw = await readCapped(ctx.req, ACCOUNT_BODY_MAX_BYTES);
  if (raw === null) return sessionJson(413, { error: 'too_large' }, setCookie);
  let body: { telemetryPlayer?: unknown } | null = null;
  if (raw.byteLength > 0) {
    try {
      body = JSON.parse(new TextDecoder().decode(raw)) as { telemetryPlayer?: unknown } | null;
    } catch {
      return sessionJson(400, { error: 'body' }, setCookie);
    }
  }
  const player = body !== null && typeof body === 'object' ? body.telemetryPlayer : undefined;
  if (player !== undefined && (typeof player !== 'string' || !ID_PATTERN.test(player))) return sessionJson(400, { error: 'telemetryPlayer' }, setCookie);
  const row = await db
    .prepare('SELECT id_hash, last_seen_day FROM member WHERE id = ?1')
    .bind(session.memberId)
    .first<{ id_hash: string; last_seen_day: number }>();
  if (row === null) return accountJson(401, { error: 'signed_out' });
  const key = 'tomb:' + row.id_hash;
  const tomb = JSON.stringify({ deletedAt: ctx.now, lastSeenDay: row.last_seen_day });
  try {
    if (typeof player === 'string') await deleteTelemetryFor(ctx.env.DB, player);
    await kv.put(key, tomb, { expirationTtl: TOMB_TTL_S });
    // false: a sign-in raised last_seen_day past `seen` meanwhile, so the guard held the batch back. Retry reads the new day.
    if (!(await deleteMember(db, session.memberId, { lastSeenAtMost: row.last_seen_day }))) {
      await dropCancelled(db, kv, row.id_hash, row.last_seen_day);
      return sessionJson(503, { error: 'retry' }, setCookie);
    }
  } catch {
    return sessionJson(503, { error: 'retry' }, setCookie);
  }
  await rewriteTomb(kv, key, tomb, ctx.deps.sleep ?? timer);
  return accountJson(200, { deleted: true }, { 'set-cookie': clearedSessionCookie() });
}

/** A tombstone whose member signed in after it was written is a cancelled deletion: `gone` must not answer 410 for a live
 *  account (a device would clear its cache). Removes the key when the member exists with a later `last_seen_day`. */
export async function dropCancelled(db: D1Like, kv: KVLike, idHash: string, tombDay: number): Promise<void> {
  const m = await db.prepare('SELECT last_seen_day FROM member WHERE id_hash = ?1').bind(idHash).first<{ last_seen_day: number }>();
  if (m !== null && m.last_seen_day > tombDay) await kv.delete('tomb:' + idHash);
}

/** POST gone `{ idHash }`: 410 for a tombstoned member, else 404. No session; works while closed. */
export async function gone(ctx: AccountCtx): Promise<Response> {
  const kv = ctx.env.ACCOUNT_TOMBSTONES;
  if (kv === undefined) return accountJson(503, { error: 'accounts are not configured' });
  if (await perMinute(ctx.req, ctx.env.ACCOUNT_LIMIT)) return accountJson(429, { error: 'limit' });
  const body = await readAccountBody<{ idHash?: unknown }>(ctx.req);
  const h = body !== null && body !== 'too_large' && typeof body === 'object' ? body.idHash : undefined;
  if (typeof h !== 'string' || !/^[0-9a-f]{64}$/.test(h)) return accountJson(400, { error: 'idHash' });
  return (await kv.get('tomb:' + h)) !== null ? accountJson(410, { deleted: true }) : accountJson(404, { error: 'not_found' });
}
