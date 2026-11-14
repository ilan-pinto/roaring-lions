/**
 * The admin gate (GH-695 S2, spec D1-D3). `handleStats` has already checked the /stats password session by the time
 * a request reaches here, so everything under `/stats/api/members/*` has factor one. A WRITE needs factor two as well:
 * the admin's own game session (`__Host-rl_session`, resolved here and never from a client field) whose member has a
 * row in `admin_member`. Nothing here reads `env.DB`: the two databases are never joined.
 */
import type { D1Like, Env } from '../d1';
import { accountJson } from '../account/http';
import { perMinute } from '../account/limits';
import { resolveSession, sessionJson, type Session } from '../account/session';
import { bump } from '../rate-day';
import { readCapped } from '../read-capped';
import { ADMIN_BODY_MAX_BYTES, ADMIN_WRITES_PER_DAY } from './config';

/** `application/json`, optionally `; charset=...`, and nothing else (no `application/jsonx`). */
const JSON_TYPE = /^application\/json\s*(;\s*charset="?[\w-]+"?\s*)?$/i;

/** True only for `flags.admin` = 'open'. A missing row, or any other value, is CLOSED (D3). */
export async function adminOpen(db: D1Like): Promise<boolean> {
  const row = await db.prepare(`SELECT value FROM flags WHERE name = 'admin'`).first<{ value: string }>();
  return row !== null && row.value === 'open';
}

export async function isAdmin(db: D1Like, memberId: string): Promise<boolean> {
  const row = await db.prepare('SELECT 1 AS one FROM admin_member WHERE member_id = ?1').bind(memberId).first<{ one: number }>();
  return row !== null;
}

/** The member behind this browser's game session, or null. Resolved from the cookie alone. */
export async function gameSession(req: Request, db: D1Like, now: number): Promise<{ session: Session; setCookie: string | null } | null> {
  return resolveSession(req, db, now);
}

/** The shared first step of every admin route: a bound accounts database and the per-minute limit. */
export async function adminDb(req: Request, env: Env): Promise<D1Like | Response> {
  const db = env.ACCOUNTS;
  if (db === undefined) return accountJson(503, { error: 'unavailable' });
  if (await perMinute(req, env.ACCOUNT_OP_LIMIT)) return accountJson(429, { error: 'limit' });
  return db;
}

export interface AdminWriter {
  db: D1Like;
  /** The acting admin's internal member id. */
  adminId: string;
  setCookie: string | null;
}

/**
 * The write gate, in the order that costs least first (D2, D1, D3, D10). Returns the writer, or the response to send:
 *  405 not POST (OPTIONS included: no CORS, ever) · 403 Origin is not exactly this Worker's own (`ALLOWED_ORIGINS` is NOT
 *  honoured) · 415 not JSON · 403 no `x-rl-admin: 1` · 503 unbound · 429 per-minute · 401 no game session · 403 not an
 *  admin · 503 `closed` (unless `requireOpen` is false: the switch must work when closed) · 429 the day cap.
 */
export async function adminWriteGate(
  req: Request,
  env: Env,
  now: number,
  opts: { requireOpen: boolean; countsToDay: boolean },
): Promise<AdminWriter | Response> {
  if (req.method !== 'POST') return accountJson(405, { error: 'method_not_allowed' }, { allow: 'POST' });
  if (req.headers.get('origin') !== new URL(req.url).origin) return accountJson(403, { error: 'origin' });
  if (!JSON_TYPE.test(req.headers.get('content-type') ?? '')) return accountJson(415, { error: 'content-type' });
  if (req.headers.get('x-rl-admin') !== '1') return accountJson(403, { error: 'forbidden' });
  const db = await adminDb(req, env);
  if (db instanceof Response) return db;
  const got = await gameSession(req, db, now);
  if (got === null) return accountJson(401, { error: 'signed_out' });
  const { setCookie } = got;
  const adminId = got.session.memberId;
  if (!(await isAdmin(db, adminId))) return sessionJson(403, { error: 'not_admin' }, setCookie);
  if (opts.requireOpen && !(await adminOpen(db))) return sessionJson(503, { error: 'closed' }, setCookie);
  if (opts.countsToDay && !(await bump(db, 'admin-writes', '', now, ADMIN_WRITES_PER_DAY))) return sessionJson(429, { error: 'limit' }, setCookie);
  return { db, adminId, setCookie };
}

/** A write's JSON object body, capped at 2 KiB (D2.7): the object, or the 413 / 400 to send. */
export async function readAdminBody(req: Request, setCookie: string | null): Promise<Record<string, unknown> | Response> {
  const bytes = await readCapped(req, ADMIN_BODY_MAX_BYTES);
  if (bytes === null) return sessionJson(413, { error: 'too_large' }, setCookie);
  try {
    const v = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    if (typeof v === 'object' && v !== null && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch {
    /* fall through */
  }
  return sessionJson(400, { error: 'body' }, setCookie);
}
