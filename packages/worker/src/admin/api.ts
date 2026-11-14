/**
 * /stats/api/members/* (GH-695 S2): whoami and the switch. The
 * /stats password session is checked by `handleStats` before this runs. Reads never touch `env.DB`, and never select a
 * Google or Steam id, a passkey, a session, a slot, or an internal member id (D5). `/stats/api/members/blank` is NOT
 * here: it keeps its own handler in stats.ts, and `/stats/api/accounts` is the telemetry view.
 */
import type { Env } from '../d1';
import { accountJson } from '../account/http';
import { sessionJson } from '../account/session';
import { adminActionInsert } from './admin-write';
import { adminDb, adminOpen, adminWriteGate, gameSession, isAdmin, readAdminBody } from './gate';

const PREFIX = '/stats/api/members/';

const notAllowed = (allow: string): Response => accountJson(405, { error: 'method_not_allowed' }, { allow });

async function whoami(req: Request, env: Env, now: number): Promise<Response> {
  if (req.method !== 'GET') return notAllowed('GET');
  const db = await adminDb(req, env);
  if (db instanceof Response) return db;
  const got = await gameSession(req, db, now);
  let publicId: string | null = null;
  let admin = false;
  if (got !== null) {
    admin = await isAdmin(db, got.session.memberId);
    publicId = (await db.prepare('SELECT public_id FROM member WHERE id = ?1').bind(got.session.memberId).first<{ public_id: string }>())?.public_id ?? null;
  }
  return sessionJson(200, { admin, publicId, open: await adminOpen(db) }, got?.setCookie ?? null);
}

/** D3: the page can CLOSE the switch and never open it. Only `{ open: false }` is accepted. Works while closed, and
 *  does not spend the day cap: the brake must never be the thing that is out of budget. */
async function closeSwitch(req: Request, env: Env, now: number): Promise<Response> {
  const w = await adminWriteGate(req, env, now, { requireOpen: false, countsToDay: false });
  if (w instanceof Response) return w;
  const body = await readAdminBody(req, w.setCookie);
  if (body instanceof Response) return body;
  if (body.open !== false) return sessionJson(400, { error: 'body' }, w.setCookie);
  await w.db.batch([
    w.db
      .prepare(
        `INSERT INTO flags (name, value, updated_at) VALUES ('admin', 'closed', ?1)
         ON CONFLICT (name) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .bind(now),
    adminActionInsert(w.db, { at: now, adminId: w.adminId, memberId: null, action: 'switch', reason: 'closed' }),
  ]);
  return sessionJson(200, { open: false }, w.setCookie);
}

export async function handleAdminApi(req: Request, env: Env, url: URL, now: number): Promise<Response> {
  const rest = url.pathname.startsWith(PREFIX) ? url.pathname.slice(PREFIX.length) : '';
  if (rest === 'whoami') return whoami(req, env, now);
  if (rest === 'switch') return closeSwitch(req, env, now);
  return accountJson(404, { error: 'not_found' });
}
