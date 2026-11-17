/**
 * /stats/api/members/* (GH-695 S2 and S3): whoami, the switch, and the read API (find, the card, the journal). The
 * /stats password session is checked by `handleStats` before this runs. Reads never touch `env.DB`, and never select a
 * Google or Steam id, a passkey, a session, a slot, or an internal member id (D5). `/stats/api/members/blank` is NOT
 * here: it keeps its own handler in stats.ts, and `/stats/api/accounts` is the telemetry view.
 */
import { migrateAccount } from '@lions/economy';
import type { D1Like, Env } from '../d1';
import { accountJson } from '../account/http';
import { sessionJson } from '../account/session';
import { bump } from '../rate-day';
import { ADMIN_READS_PER_DAY, FIND_MAX, FIND_NAME_MAX, FIND_NAME_MIN, JOURNAL_PAGE } from './config';
import { adminActionInsert } from './admin-write';
import { coinsRoute } from './coins';
import { adminDb, adminOpen, adminWriteGate, gameSession, isAdmin, readAdminBody } from './gate';

const PREFIX = '/stats/api/members/';
const PUBLIC_ID = /^[0-9A-HJKMNP-TV-Z]{8}$/;
const DAY_MS = 86_400_000;
const MAX_LIKE_BYTES = 48;

const notAllowed = (allow: string): Response => accountJson(405, { error: 'method_not_allowed' }, { allow });
const isoDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const KIND_WORD: Record<string, string> = { google: 'Google', steam: 'Steam', passkey: 'Passkey', recovery: 'Recovery code' };

/** The only reads that count toward the day cap (D10): find, the card and the journal. */
async function readBudget(db: D1Like, now: number): Promise<Response | null> {
  return (await bump(db, 'admin-reads', '', now, ADMIN_READS_PER_DAY)) ? null : accountJson(429, { error: 'limit' });
}

/** The sign-in KINDS of the given members, as words, never a subject. */
async function kindsOf(db: D1Like, ids: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (ids.length === 0) return out;
  const marks = ids.map((_, i) => `?${i + 1}`).join(',');
  const rows = await db
    .prepare(`SELECT member_id, provider FROM member_identity WHERE member_id IN (${marks}) AND state = 'active' GROUP BY member_id, provider ORDER BY provider`)
    .bind(...ids)
    .all<{ member_id: string; provider: string }>();
  for (const r of rows.results) out.set(r.member_id, [...(out.get(r.member_id) ?? []), KIND_WORD[r.provider] ?? r.provider]);
  return out;
}

interface FindRow {
  id: string;
  public_id: string;
  display_name: string;
  created_at: number;
  last_seen_day: number;
  coins: number | null;
  credits: number | null;
}

const FIND_SELECT = `SELECT m.id AS id, m.public_id AS public_id, p.display_name AS display_name, m.created_at AS created_at,
       m.last_seen_day AS last_seen_day, w.free AS coins,
       CASE WHEN json_valid(c.brigade) THEN json_extract(c.brigade, '$.balance') END AS credits
FROM member m
JOIN profile p ON p.member_id = m.id
LEFT JOIN wallet w ON w.member_id = m.id
LEFT JOIN campaign_state c ON c.member_id = m.id`;

async function summaries(db: D1Like, rows: FindRow[]): Promise<unknown[]> {
  const kinds = await kindsOf(db, rows.map((r) => r.id));
  return rows.map((r) => ({
    publicId: r.public_id,
    displayName: r.display_name,
    created: isoDay(r.created_at),
    lastSeen: isoDay(r.last_seen_day * DAY_MS),
    kinds: kinds.get(r.id) ?? [],
    coins: r.coins,
    // The finder reads the stored balance as is; the card shows `migrateAccount`'s (bounded) reading.
    credits: typeof r.credits === 'number' ? r.credits : null,
  }));
}

const escapeLike = (s: string): string => s.replace(/[\\%_]/g, (c) => '\\' + c);

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

async function find(req: Request, env: Env, url: URL, now: number): Promise<Response> {
  if (req.method !== 'GET') return notAllowed('GET');
  const db = await adminDb(req, env);
  if (db instanceof Response) return db;
  // NFKC, as stored names are cleaned (cleanCallsign), so a compatibility form finds its name.
  const q = (url.searchParams.get('q') ?? '').normalize('NFKC').trim();
  if (q === '') return accountJson(400, { error: 'q' });
  const chars = [...q];
  const isMe = q.toLowerCase() === 'me';
  // A name search needs 3 characters (D5); a shorter query that is not "me" is refused before it spends a read.
  if (!isMe && chars.length < FIND_NAME_MIN && !PUBLIC_ID.test(q.toUpperCase())) return accountJson(400, { error: 'q' });
  const over = await readBudget(db, now);
  if (over !== null) return over;
  if (isMe) {
    const got = await gameSession(req, db, now);
    if (got === null) return accountJson(401, { error: 'signed_out' });
    const rows = await db.prepare(`${FIND_SELECT} WHERE m.id = ?1`).bind(got.session.memberId).all<FindRow>();
    return sessionJson(200, { members: await summaries(db, rows.results) }, got.setCookie);
  }
  const upper = q.toUpperCase();
  if (PUBLIC_ID.test(upper)) {
    const exact = await db.prepare(`${FIND_SELECT} WHERE m.public_id = ?1`).bind(upper).all<FindRow>();
    if (exact.results.length > 0) return accountJson(200, { members: await summaries(db, exact.results) });
  }
  const pattern = escapeLike(q) + '%';
  // Longer than any display name, or a LIKE pattern past D1's 50-byte limit (which would be a 500): nothing can match.
  if (chars.length > FIND_NAME_MAX || new TextEncoder().encode(pattern).length > MAX_LIKE_BYTES) return accountJson(200, { members: [] });
  const rows = await db
    .prepare(`${FIND_SELECT} WHERE p.display_name LIKE ?1 ESCAPE '\\' ORDER BY m.last_seen_day DESC, m.created_at DESC, m.public_id LIMIT ?2`)
    .bind(pattern, FIND_MAX)
    .all<FindRow>();
  return accountJson(200, { members: await summaries(db, rows.results) });
}

interface MemberRow {
  id: string;
  public_id: string;
  display_name: string;
  created_at: number;
  last_seen_day: number;
}

async function memberByPublicId(db: D1Like, publicId: string): Promise<MemberRow | null> {
  return db
    .prepare('SELECT m.id AS id, m.public_id AS public_id, p.display_name AS display_name, m.created_at AS created_at, m.last_seen_day AS last_seen_day FROM member m JOIN profile p ON p.member_id = m.id WHERE m.public_id = ?1')
    .bind(publicId)
    .first<MemberRow>();
}

/** Logs one 'view' of a member, with the viewer's admin id when the browser holds an admin's game session. Returns the session. */
async function logView(req: Request, db: D1Like, memberId: string, now: number) {
  const viewer = await gameSession(req, db, now);
  const adminId = viewer !== null && (await isAdmin(db, viewer.session.memberId)) ? viewer.session.memberId : null;
  await adminActionInsert(db, { at: now, adminId, memberId, action: 'view' }).run();
  return viewer;
}

async function card(req: Request, env: Env, publicId: string, now: number): Promise<Response> {
  if (req.method !== 'GET') return notAllowed('GET');
  const db = await adminDb(req, env);
  if (db instanceof Response) return db;
  const over = await readBudget(db, now);
  if (over !== null) return over;
  const m = await memberByPublicId(db, publicId);
  if (m === null) return accountJson(404, { error: 'not_found' });
  const wallet = await db.prepare('SELECT free, paid, revision, updated_at FROM wallet WHERE member_id = ?1').bind(m.id).first<{ free: number; paid: number; revision: number; updated_at: number }>();
  const last = await db
    .prepare('SELECT at, kind, free_delta FROM coin_journal WHERE member_id = ?1 ORDER BY id DESC LIMIT 1')
    .bind(m.id)
    .first<{ at: number; kind: string; free_delta: number }>();
  const camp = await db
    .prepare('SELECT brigade, revision, updated_at FROM campaign_state WHERE member_id = ?1')
    .bind(m.id)
    .first<{ brigade: string; revision: number; updated_at: number }>();
  let credits: unknown = null;
  if (camp !== null) {
    let raw: unknown = null;
    try {
      raw = JSON.parse(camp.brigade) as unknown;
    } catch {
      /* migrateAccount reads null as an empty account */
    }
    const acct = migrateAccount(raw);
    credits = {
      balance: acct.balance,
      earnedTotal: acct.earned_total,
      grantedTotal: acct.grants.reduce((n, g) => (g.source === 'granted' ? n + g.amount : n), 0),
      revision: camp.revision,
      syncedAt: camp.updated_at,
    };
  }
  // D14.2: every card opened is logged. A view from a browser with no admin game session is logged with no admin.
  const viewer = await logView(req, db, m.id, now);
  const [summary] = (await summaries(db, [{ ...m, coins: wallet?.free ?? null, credits: null }])) as { kinds: string[] }[];
  return sessionJson(
    200,
    {
      member: { publicId: m.public_id, displayName: m.display_name, created: isoDay(m.created_at), lastSeen: isoDay(m.last_seen_day * DAY_MS), kinds: summary?.kinds ?? [] },
      coins: wallet === null ? null : { free: wallet.free, paid: wallet.paid, revision: wallet.revision, updatedAt: wallet.updated_at, lastChange: last === null ? null : { at: last.at, kind: last.kind, delta: last.free_delta } },
      credits,
    },
    viewer?.setCookie ?? null,
  );
}

const CURSOR = /^(\d{1,16})\.([ac])\.(\d{1,15})$/;

/** The merged journal (D6): the player's own coin history beside the admin's changes, newest first. A coin grant is one
 *  coin_journal row AND one admin_action row; the admin_action row carries the before, after, reason and admin, so the
 *  coin row of kind 'admin' is left out here rather than listed twice. */
async function journal(req: Request, env: Env, url: URL, publicId: string, now: number): Promise<Response> {
  if (req.method !== 'GET') return notAllowed('GET');
  const db = await adminDb(req, env);
  if (db instanceof Response) return db;
  const currency = url.searchParams.get('currency');
  if (currency !== null && currency !== 'coins' && currency !== 'credits') return accountJson(400, { error: 'currency' });
  const before = url.searchParams.get('before');
  const cur = before === null ? null : CURSOR.exec(before);
  if (before !== null && cur === null) return accountJson(400, { error: 'before' });
  const over = await readBudget(db, now);
  if (over !== null) return over;
  const m = await memberByPublicId(db, publicId);
  if (m === null) return accountJson(404, { error: 'not_found' });
  // D14.2: the first page of a journal is an access too (a journal-only read must leave a trace); later pages are not.
  if (cur === null) await logView(req, db, m.id, now);
  const rows = await db
    .prepare(
      `SELECT * FROM (
         SELECT 'c' AS src, j.id AS id, j.at AS at, 'coins' AS currency, j.kind AS kind, NULL AS mode, j.free_delta AS delta,
                NULL AS "before", NULL AS "after", NULL AS reason, 'player' AS "by", j.op_id AS op_id, NULL AS note
         FROM coin_journal j WHERE j.member_id = ?1 AND j.kind != 'admin'
         UNION ALL
         SELECT 'a', a.id, a.at, a.action, 'admin', a.mode, a.delta, a."before", a."after", a.reason, COALESCE(x.public_id, 'admin'), a.op_id,
                (SELECT CASE WHEN json_valid(c.detail) AND json_type(c.detail, '$.note') = 'text' THEN json_extract(c.detail, '$.note') END
                 FROM coin_journal c WHERE c.member_id = a.member_id AND c.op_id = a.op_id AND c.kind = 'admin' AND a.action = 'coins')
         FROM admin_action a LEFT JOIN member x ON x.id = a.admin_id
         WHERE a.member_id = ?1 AND a.action IN ('coins', 'credits')
       )
       WHERE (?2 IS NULL OR currency = ?2)
         AND (?3 IS NULL OR at < ?3 OR (at = ?3 AND (src > ?4 OR (src = ?4 AND id < ?5))))
       ORDER BY at DESC, src ASC, id DESC LIMIT ?6`,
    )
    .bind(m.id, currency, cur === null ? null : Number(cur[1]), cur === null ? null : cur[2], cur === null ? null : Number(cur[3]), JOURNAL_PAGE + 1)
    .all<{ src: string; id: number; at: number; currency: string; kind: string; mode: string | null; delta: number; before: number | null; after: number | null; reason: string | null; by: string; op_id: string | null; note: string | null }>();
  const page = rows.results.slice(0, JOURNAL_PAGE);
  const last = page[page.length - 1];
  return accountJson(200, {
    rows: page.map((r) => ({ at: r.at, currency: r.currency, kind: r.kind, mode: r.mode, delta: r.delta, before: r.before, after: r.after, reason: r.reason, note: r.note, by: r.by, opId: r.op_id })),
    next: rows.results.length > JOURNAL_PAGE && last !== undefined ? `${last.at}.${last.src}.${last.id}` : null,
  });
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
  if (rest === 'find') return find(req, env, url, now);
  if (rest === 'switch') return closeSwitch(req, env, now);
  const m = /^([^/]+)(\/journal|\/coins)?$/.exec(rest);
  if (m !== null) {
    const publicId = (m[1] ?? '').toUpperCase();
    if (!PUBLIC_ID.test(publicId)) return accountJson(400, { error: 'bad_request' });
    if (m[2] === '/coins') return coinsRoute(req, env, publicId, now);
    return m[2] === undefined ? card(req, env, publicId, now) : journal(req, env, url, publicId, now);
  }
  return accountJson(404, { error: 'not_found' });
}
