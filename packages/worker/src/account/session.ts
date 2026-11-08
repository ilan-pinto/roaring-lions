/** Stateful account sessions (GH-1075 A1). The cookie value is 32 random bytes; only its sha256 is stored,
 *  so a database read never yields a usable cookie, and a signed-out member's token is dead the moment its row goes. */
import { readCookie } from '../auth';
import type { D1Like, D1Stmt } from '../d1';
import { dayOf } from '../rate-day';
import { FRESH_MS, MAX_SESSIONS, SESSION_ABS_MS, SESSION_COOKIE, SESSION_IDLE_MS } from './config';
import { randomB64url, sha256Hex } from './crypto';
import { accountJson } from './http';
import type { AccountCtx } from './routes';

export interface Session {
  tokenHash: string;
  memberId: string;
  expiresAt: number;
  absoluteAt: number;
  freshUntil: number;
  lastSeenDay: number;
}

const ATTRS = 'Secure; HttpOnly; SameSite=Strict; Path=/';

export function sessionCookie(token: string, maxAgeS: number): string {
  return `${SESSION_COOKIE}=${token}; ${ATTRS}; Max-Age=${maxAgeS}`;
}

export function clearedSessionCookie(): string {
  return `${SESSION_COOKIE}=; ${ATTRS}; Max-Age=0`;
}

/** The statements that make a session: its insert, the eviction of everything beyond `MAX_SESSIONS` (oldest
 *  first), and the member's `last_seen_day`. The caller puts them in its own batch. */
export async function createSession(
  db: D1Like,
  memberId: string,
  now: number,
): Promise<{ token: string; setCookie: string; statements: D1Stmt[] }> {
  const token = randomB64url(32);
  const tokenHash = await sha256Hex(token);
  const day = dayOf(now);
  const statements: D1Stmt[] = [
    db.prepare(
      'INSERT INTO session (token_hash, member_id, created_at, expires_at, absolute_at, fresh_until, last_seen_day) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)',
    ).bind(tokenHash, memberId, now, now + SESSION_IDLE_MS, now + SESSION_ABS_MS, now + FRESH_MS, day),
    db.prepare(
      `DELETE FROM session WHERE member_id = ?1 AND token_hash NOT IN
         (SELECT token_hash FROM session WHERE member_id = ?1 ORDER BY created_at DESC, rowid DESC LIMIT ?2)`,
    ).bind(memberId, MAX_SESSIONS),
    db.prepare('UPDATE member SET last_seen_day = max(last_seen_day, ?2) WHERE id = ?1').bind(memberId, day),
  ];
  return { token, setCookie: sessionCookie(token, Math.floor(SESSION_IDLE_MS / 1000)), statements };
}

interface SessionRow {
  token_hash: string;
  member_id: string;
  expires_at: number;
  absolute_at: number;
  fresh_until: number;
  last_seen_day: number;
}

/** The live session behind the request's cookie, slid at most once a UTC day (and then the cookie is re-sent). */
export async function resolveSession(
  req: Request,
  db: D1Like,
  now: number,
): Promise<{ session: Session; setCookie: string | null } | null> {
  const token = readCookie(req, SESSION_COOKIE);
  if (token === null || token === '') return null;
  const tokenHash = await sha256Hex(token);
  const row = await db
    .prepare('SELECT token_hash, member_id, expires_at, absolute_at, fresh_until, last_seen_day FROM session WHERE token_hash = ?1')
    .bind(tokenHash)
    .first<SessionRow>();
  if (row === null || row.expires_at <= now || row.absolute_at <= now) return null;
  const session: Session = {
    tokenHash: row.token_hash,
    memberId: row.member_id,
    expiresAt: row.expires_at,
    absoluteAt: row.absolute_at,
    freshUntil: row.fresh_until,
    lastSeenDay: row.last_seen_day,
  };
  const day = dayOf(now);
  if (day === row.last_seen_day) return { session, setCookie: null };
  const expiresAt = Math.min(now + SESSION_IDLE_MS, row.absolute_at);
  await db.batch([
    db.prepare('UPDATE session SET expires_at = ?2, last_seen_day = ?3 WHERE token_hash = ?1').bind(tokenHash, expiresAt, day),
    db.prepare('UPDATE member SET last_seen_day = max(last_seen_day, ?2) WHERE id = ?1').bind(row.member_id, day),
  ]);
  return {
    session: { ...session, expiresAt, lastSeenDay: day },
    setCookie: sessionCookie(token, Math.max(0, Math.floor((expiresAt - now) / 1000))),
  };
}

export function isFresh(s: Session, now: number): boolean {
  return s.freshUntil > now;
}

/** A route's session gate: the session, or the 401 (`signed_out`) / 403 (`reauth`) to return as is. */
export async function requireSession(
  ctx: AccountCtx,
  opts: { fresh?: boolean } = {},
): Promise<{ session: Session; setCookie: string | null } | Response> {
  const db = ctx.env.ACCOUNTS;
  if (db === undefined) return accountJson(503, { error: 'accounts are not configured' });
  const found = await resolveSession(ctx.req, db, ctx.now);
  if (found === null) return accountJson(401, { error: 'signed_out' });
  if (opts.fresh === true && !isFresh(found.session, ctx.now)) return accountJson(403, { error: 'reauth' }, found.setCookie === null ? undefined : { 'set-cookie': found.setCookie });
  return found;
}

/** A JSON answer that carries the slide's `Set-Cookie` when there is one. */
export function sessionJson(status: number, body: unknown, setCookie: string | null): Response {
  return accountJson(status, body, setCookie === null ? undefined : { 'set-cookie': setCookie });
}
