/** Deleting an account (GH-1075 A1, spec §6.4). Every step is retryable while the session still exists. */
import { ID_PATTERN } from '@lions/data/telemetry';
import type { D1Like } from '../d1';
import { TOMB_TTL_S } from './config';
import { accountJson, readAccountBody } from './http';
import type { AccountCtx } from './routes';
import { clearedSessionCookie, requireSession, sessionJson } from './session';
import { deleteStatements } from './tables';

/** Added to every statement that binds the member. The batch is one transaction, so a sign-in that stamps
 *  `last_seen_day` past the guard either commits first (every guarded statement then deletes nothing) or after
 *  (the identity is gone and the sign-in resolves no member). `member` goes last, so the guard holds throughout. */
const GUARD = ' AND EXISTS (SELECT 1 FROM member WHERE id = ?1 AND last_seen_day <= ?2)';

/** One guarded batch over every member table. True when the member row is gone afterwards. */
export async function deleteMember(db: D1Like, memberId: string, guard: { lastSeenAtMost: number }): Promise<boolean> {
  const statements = deleteStatements().map((s) =>
    s.bindsMember ? db.prepare(s.sql + GUARD).bind(memberId, guard.lastSeenAtMost) : db.prepare(s.sql),
  );
  await db.batch(statements);
  const left = await db.prepare('SELECT 1 AS one FROM member WHERE id = ?1').bind(memberId).first<{ one: number }>();
  return left === null;
}

/** The telemetry database's rows for one player, in one batch. Idempotent; touches no account row. */
export async function deleteTelemetryFor(db: D1Like, player: string): Promise<void> {
  if (!ID_PATTERN.test(player)) throw new Error('bad telemetry player id');
  // The attachments first: the test database does not enforce foreign keys, and a row must not outlive its note.
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

/** POST delete: a fresh session. Telemetry (if asked), then the tombstone, then the guarded batch. */
export async function deleteAccount(ctx: AccountCtx): Promise<Response> {
  const got = await requireSession(ctx, { fresh: true });
  if (got instanceof Response) return got;
  const db = ctx.env.ACCOUNTS;
  const kv = ctx.env.ACCOUNT_TOMBSTONES;
  if (db === undefined || kv === undefined) return accountJson(503, { error: 'accounts are not configured' });
  const { session, setCookie } = got;
  const body = await readAccountBody<{ telemetryPlayer?: unknown }>(ctx.req);
  if (body === 'too_large') return sessionJson(413, { error: 'too_large' }, setCookie);
  const player = body !== null && typeof body === 'object' ? body.telemetryPlayer : undefined;
  if (player !== undefined && (typeof player !== 'string' || !ID_PATTERN.test(player))) return sessionJson(400, { error: 'telemetryPlayer' }, setCookie);
  const row = await db
    .prepare('SELECT id_hash, last_seen_day FROM member WHERE id = ?1')
    .bind(session.memberId)
    .first<{ id_hash: string; last_seen_day: number }>();
  if (row === null) return accountJson(401, { error: 'signed_out' });
  try {
    if (typeof player === 'string') await deleteTelemetryFor(ctx.env.DB, player);
    await kv.put('tomb:' + row.id_hash, JSON.stringify({ deletedAt: ctx.now, lastSeenDay: row.last_seen_day }), { expirationTtl: TOMB_TTL_S });
    // false: a sign-in raised last_seen_day past `seen` meanwhile, so the guard held the batch back. Retry reads the new day.
    if (!(await deleteMember(db, session.memberId, { lastSeenAtMost: row.last_seen_day }))) {
      return sessionJson(503, { error: 'retry' }, setCookie);
    }
  } catch {
    return sessionJson(503, { error: 'retry' }, setCookie);
  }
  return accountJson(200, { deleted: true }, { 'set-cookie': clearedSessionCookie() });
}

/** POST gone `{ idHash }`: 410 for a tombstoned member, else 404. No session; works while closed. */
export async function gone(ctx: AccountCtx): Promise<Response> {
  const kv = ctx.env.ACCOUNT_TOMBSTONES;
  if (kv === undefined) return accountJson(503, { error: 'accounts are not configured' });
  const body = await readAccountBody<{ idHash?: unknown }>(ctx.req);
  const h = body !== null && body !== 'too_large' && typeof body === 'object' ? body.idHash : undefined;
  if (typeof h !== 'string' || !/^[0-9a-f]{64}$/.test(h)) return accountJson(400, { error: 'idHash' });
  return (await kv.get('tomb:' + h)) !== null ? accountJson(410, { deleted: true }) : accountJson(404, { error: 'not_found' });
}
