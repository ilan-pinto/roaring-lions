/**
 * /stats/feedback: the lead's triage view over the `feedback` table (GH-464,
 * spec §5.3, mocks 07-08). Every route here sits behind the same signed
 * session as /stats; `stats.ts` checks it BEFORE dispatching to this module,
 * so nothing in this file is reachable signed out (`feedback-triage.test.ts`
 * walks every route without a cookie).
 *
 * API (all under /stats/api/feedback):
 *   GET  ?status=&tester=&mission=&kind=   the list, counts and filter options
 *   GET  /count                             {"new":N} for the /stats badge
 *   GET  /:id                               one row, its context, replay summary,
 *                                           session timeline and the issue link
 *   GET  /:id/shot[?download=1]             the picture, from D1's feedback_picture, WebP, nosniff
 *   GET  /:id/replay                        the replay JSON, as a download
 *   POST /:id   {"action": ...}             triage | dismiss | reopen | file | issue | note | delete
 *   POST /switch {"open": true|false}       the kill switch's D1 half
 */
import type { D1Like, Env } from './d1';
import { feedbackRef, FEEDBACK_CATEGORIES, TEXT_MAX } from './feedback-meta';
import { buildIssueLink, type IssueLink } from './feedback-issue';
import { feedbackOpen } from './feedback-ingest';

export const FEEDBACK_STATUSES = ['new', 'triaged', 'filed', 'dismissed'] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];
/** Where each status may go. `filed` is on GitHub, so it can only step back
 *  to `triaged` (a mistaken click), never be dismissed or reopened as new. */
export const TRANSITIONS: Record<FeedbackStatus, readonly FeedbackStatus[]> = {
  new: ['triaged', 'filed', 'dismissed'],
  triaged: ['new', 'filed', 'dismissed'],
  filed: ['triaged'],
  dismissed: ['new', 'triaged'],
};
const ACTION_TARGET: Record<string, FeedbackStatus> = { triage: 'triaged', dismiss: 'dismissed', reopen: 'new', file: 'filed' };
export const ANONYMOUS = '*anonymous';
export const NO_MISSION = '*none';
const ISSUE_MAX = 10_000_000;
const MAX_ACTION_BODY = 8 * 1024;
const TIMELINE_MAX = 300;

const NO_STORE = { 'cache-control': 'no-store' } as const;
const json = (x: unknown, status = 200): Response =>
  new Response(JSON.stringify(x), { status, headers: { 'content-type': 'application/json', ...NO_STORE } });
const NOT_FOUND = (): Response => json({ error: 'not found' }, 404);

interface Row {
  id: number;
  received_at: number;
  t: number;
  player: string | null;
  session: string | null;
  tester: string | null;
  build: string;
  commit: string | null;
  source: string;
  category: string;
  rating: number | null;
  text: string;
  contact: string | null;
  mission: string | null;
  map: string | null;
  tick: number | null;
  context: string;
  shot_bytes: number | null;
  replay_bytes: number | null;
  dev: number;
  status: FeedbackStatus;
  issue: number | null;
  note: string | null;
  updated_at: number;
}

export interface FeedbackFilter {
  status: FeedbackStatus | 'all';
  tester?: string;
  mission?: string;
  kind?: string;
}

export function parseFeedbackFilter(url: URL): FeedbackFilter {
  const s = url.searchParams.get('status');
  const status = (FEEDBACK_STATUSES as readonly string[]).includes(s ?? '') ? (s as FeedbackStatus) : 'all';
  const opt = (k: string): string | undefined => url.searchParams.get(k) || undefined;
  return { status, tester: opt('tester'), mission: opt('mission'), kind: opt('kind') };
}

/** WHERE for tester/mission/kind (not status: the tab counts are per status). */
function whereOthers(f: FeedbackFilter): { sql: string; args: unknown[] } {
  const parts: string[] = [];
  const args: unknown[] = [];
  if (f.tester === ANONYMOUS) parts.push('tester IS NULL');
  else if (f.tester !== undefined) {
    parts.push('tester = ?');
    args.push(f.tester);
  }
  if (f.mission === NO_MISSION) parts.push('mission IS NULL');
  else if (f.mission !== undefined) {
    parts.push('mission = ?');
    args.push(f.mission);
  }
  if (f.kind !== undefined) {
    parts.push('category = ?');
    args.push(f.kind);
  }
  return { sql: parts.length ? parts.join(' AND ') : '1', args };
}

const short = (s: string | null): string | null => (s === null ? null : s.slice(0, 8));
const snippet = (s: string): string => {
  const line = s.replace(/\s+/g, ' ').trim();
  const cps = [...line];
  return cps.length > 80 ? `${cps.slice(0, 80).join('')}…` : line;
};

export async function listFeedback(db: D1Like, f: FeedbackFilter) {
  const w = whereOthers(f);
  const statusSql = f.status === 'all' ? '' : ' AND status = ?';
  const rows = await db
    .prepare(
      `SELECT id, received_at, tester, session, category, mission, rating, text, shot_bytes, replay_bytes, status, issue, dev
       FROM feedback WHERE ${w.sql}${statusSql} ORDER BY received_at DESC, id DESC LIMIT 500`
    )
    .bind(...w.args, ...(f.status === 'all' ? [] : [f.status]))
    .all<Pick<Row, 'id' | 'received_at' | 'tester' | 'session' | 'category' | 'mission' | 'rating' | 'text' | 'shot_bytes' | 'replay_bytes' | 'status' | 'issue' | 'dev'>>();
  const byStatus = await db
    .prepare(`SELECT status, COUNT(*) AS n FROM feedback WHERE ${w.sql} GROUP BY status`)
    .bind(...w.args)
    .all<{ status: FeedbackStatus; n: number }>();
  const counts: Record<FeedbackStatus | 'all', number> = { new: 0, triaged: 0, filed: 0, dismissed: 0, all: 0 };
  for (const r of byStatus.results) {
    counts[r.status] = r.n;
    counts.all += r.n;
  }
  const testers = await db.prepare('SELECT DISTINCT tester FROM feedback WHERE tester IS NOT NULL ORDER BY tester').all<{ tester: string }>();
  const missions = await db.prepare('SELECT DISTINCT mission FROM feedback WHERE mission IS NOT NULL ORDER BY mission').all<{ mission: string }>();
  return {
    counts,
    testers: testers.results.map((r) => r.tester),
    missions: missions.results.map((r) => r.mission),
    kinds: FEEDBACK_CATEGORIES,
    rows: rows.results.map((r) => ({
      id: r.id,
      ref: feedbackRef(r.id),
      receivedAt: r.received_at,
      tester: r.tester,
      who: r.tester ?? 'anonymous',
      session: short(r.session),
      category: r.category,
      mission: r.mission,
      rating: r.rating,
      snippet: snippet(r.text),
      shot: r.shot_bytes !== null,
      replay: r.replay_bytes !== null,
      status: r.status,
      issue: r.issue,
      dev: r.dev === 1,
    })),
  };
}

export async function newCount(db: D1Like): Promise<number> {
  const row = await db.prepare(`SELECT COUNT(*) AS n FROM feedback WHERE status = 'new'`).first<{ n: number }>();
  return row?.n ?? 0;
}

const getRow = (db: D1Like, id: number): Promise<Row | null> => db.prepare('SELECT * FROM feedback WHERE id = ?').bind(id).first<Row>();

function parseContext(s: string): Record<string, unknown> {
  try {
    const x = JSON.parse(s) as unknown;
    return typeof x === 'object' && x !== null && !Array.isArray(x) ? (x as Record<string, unknown>) : {};
  } catch {
    return {}; // ingest validated it; one bad row must still not 500 the page
  }
}

async function replaySummary(db: D1Like, r: Row) {
  if (r.replay_bytes === null) return null;
  const obj = await db.prepare('SELECT json FROM feedback_replay WHERE feedback_id = ?').bind(r.id).first<{ json: string }>();
  if (!obj) return { missing: true as const };
  let commands: number | null = null;
  let hash: string | null = null;
  let tick: number | null = null;
  try {
    const j = JSON.parse(obj.json) as Record<string, unknown>;
    if (Array.isArray(j.commands)) commands = j.commands.length;
    if (typeof j.hash === 'string' || typeof j.hash === 'number') hash = String(j.hash).slice(0, 40);
    if (typeof j.tick === 'number') tick = j.tick;
  } catch {
    /* summarise what we can; the download still works */
  }
  return { bytes: r.replay_bytes, commands, hash, tick };
}

/** The `events` rows of this row's session, oldest first, with every feedback
 *  row from the same session interleaved (the join the spec's §5.3 asks for). */
export async function sessionTimeline(db: D1Like, session: string | null) {
  if (session === null) return [];
  const events = await db
    .prepare(
      `SELECT t, type, mission, json_extract(payload, '$.result') AS result FROM events
       WHERE session = ? ORDER BY t ASC LIMIT ${TIMELINE_MAX}`
    )
    .bind(session)
    .all<{ t: number; type: string; mission: string | null; result: string | null }>();
  const notes = await db
    .prepare('SELECT id, t, mission FROM feedback WHERE session = ? ORDER BY t ASC LIMIT 50')
    .bind(session)
    .all<{ id: number; t: number; mission: string | null }>();
  return [
    ...events.results.map((e) => ({ t: e.t, type: e.type, mission: e.mission, result: e.result, feedbackId: null as number | null })),
    ...notes.results.map((n) => ({ t: n.t, type: 'feedback', mission: n.mission, result: feedbackRef(n.id), feedbackId: n.id })),
  ].sort((a, b) => a.t - b.t);
}

export async function feedbackDetail(env: Env, id: number, origin: string) {
  const r = await getRow(env.DB, id);
  if (!r) return null;
  const context = parseContext(r.context);
  const issue: IssueLink = buildIssueLink(
    {
      id: r.id, category: r.category, rating: r.rating, text: r.text, mission: r.mission, tick: r.tick, build: r.build,
      commit: r.commit, context, hasReplay: r.replay_bytes !== null, tester: r.tester, contact: r.contact, player: r.player, session: r.session,
    },
    origin
  );
  return {
    id: r.id,
    ref: feedbackRef(r.id),
    receivedAt: r.received_at,
    t: r.t,
    who: r.tester ?? 'anonymous',
    tester: r.tester,
    player: short(r.player),
    session: short(r.session),
    contact: r.contact,
    build: r.build,
    commit: r.commit,
    source: r.source,
    category: r.category,
    rating: r.rating,
    text: r.text,
    mission: r.mission,
    map: r.map,
    tick: r.tick,
    dev: r.dev === 1,
    status: r.status,
    transitions: TRANSITIONS[r.status],
    issueNumber: r.issue,
    note: r.note,
    updatedAt: r.updated_at,
    context,
    shot: r.shot_bytes !== null,
    replay: await replaySummary(env.DB, r),
    issue,
    timeline: await sessionTimeline(env.DB, r.session),
  };
}

export type ActionResult = { ok: true; status: FeedbackStatus | 'deleted' } | { ok: false; code: number; error: string };

/** Applies one triage action. Pure over the database and the blob store, so
 *  every transition is a unit test without HTTP. */
export async function applyFeedbackAction(env: Env, id: number, body: Record<string, unknown>, now: number): Promise<ActionResult> {
  const r = await getRow(env.DB, id);
  if (!r) return { ok: false, code: 404, error: 'not found' };
  const action = body.action;
  if (action === 'delete') {
    // Explicit, in one transaction: the ON DELETE CASCADE in 0003 needs
    // foreign keys on, which D1 has and a plain SQLite connection may not.
    await env.DB.batch([
      env.DB.prepare('DELETE FROM feedback_picture WHERE feedback_id = ?').bind(id),
      env.DB.prepare('DELETE FROM feedback_replay WHERE feedback_id = ?').bind(id),
      env.DB.prepare('DELETE FROM feedback WHERE id = ?').bind(id),
    ]);
    return { ok: true, status: 'deleted' };
  }
  if (action === 'note') {
    const note = body.note;
    if (typeof note !== 'string' || [...note].length > TEXT_MAX) return { ok: false, code: 400, error: 'note' };
    await env.DB.prepare('UPDATE feedback SET note = ?, updated_at = ? WHERE id = ?').bind(note.trim() === '' ? null : note, now, id).run();
    return { ok: true, status: r.status };
  }
  let to: FeedbackStatus;
  let issue = r.issue;
  if (action === 'issue' || action === 'file') {
    const n = body.issue;
    if (action === 'issue' || n !== undefined) {
      if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > ISSUE_MAX) return { ok: false, code: 400, error: 'issue' };
      issue = n;
    }
    to = 'filed';
  } else if (typeof action === 'string' && action in ACTION_TARGET) {
    to = ACTION_TARGET[action];
  } else {
    return { ok: false, code: 400, error: 'action' };
  }
  if (to !== r.status && !TRANSITIONS[r.status].includes(to)) {
    return { ok: false, code: 409, error: `cannot go from ${r.status} to ${to}` };
  }
  await env.DB.prepare('UPDATE feedback SET status = ?, issue = ?, updated_at = ? WHERE id = ?').bind(to, issue, now, id).run();
  return { ok: true, status: to };
}

export async function setFeedbackOpen(db: D1Like, open: boolean, now: number): Promise<void> {
  await db
    .prepare(
      `INSERT INTO flags (name, value, updated_at) VALUES ('feedback', ?, ?)
       ON CONFLICT (name) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
    .bind(open ? 'open' : 'closed', now)
    .run();
}

/** A state-changing request must come from the dashboard itself: same Origin
 *  (always sent on a fetch POST) and a JSON body, which a cross-site form
 *  cannot send without a preflight. The cookie is SameSite=Strict as well. */
async function readActionBody(req: Request): Promise<Record<string, unknown> | Response> {
  if (req.headers.get('origin') !== new URL(req.url).origin) return json({ error: 'origin' }, 403);
  if (!/^application\/json\b/i.test(req.headers.get('content-type') ?? '')) return json({ error: 'content-type' }, 415);
  const declared = req.headers.get('content-length');
  if (declared !== null && Number(declared) > MAX_ACTION_BODY) return json({ error: 'too large' }, 413);
  const text = await req.text();
  if (new TextEncoder().encode(text).length > MAX_ACTION_BODY) return json({ error: 'too large' }, 413);
  try {
    const x = JSON.parse(text) as unknown;
    if (typeof x === 'object' && x !== null && !Array.isArray(x)) return x as Record<string, unknown>;
  } catch {
    /* fall through */
  }
  return json({ error: 'body' }, 400);
}

/** The attachments, read from their own tables -- the only place a picture's
 *  bytes are ever selected. */
async function serveAttachment(env: Env, id: number, which: 'shot' | 'replay', download: boolean): Promise<Response> {
  let body: Uint8Array<ArrayBuffer> | string;
  if (which === 'shot') {
    const row = await env.DB.prepare('SELECT bytes FROM feedback_picture WHERE feedback_id = ?').bind(id).first<{ bytes: ArrayLike<number> }>();
    if (!row) return NOT_FOUND();
    body = new Uint8Array(row.bytes); // D1 hands a BLOB back as a number array, node:sqlite as a Uint8Array
  } else {
    const row = await env.DB.prepare('SELECT json FROM feedback_replay WHERE feedback_id = ?').bind(id).first<{ json: string }>();
    if (!row) return NOT_FOUND();
    body = row.json;
  }
  // Only WebP is ever stored (sniffed at ingest), so the type is fixed here,
  // and nosniff stops a browser second-guessing it.
  const name = which === 'shot' ? `${feedbackRef(id)}.webp` : `${feedbackRef(id)}-replay.json`;
  const attach = which === 'replay' || download;
  return new Response(body, {
    headers: {
      'content-type': which === 'shot' ? 'image/webp' : 'application/json',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
      'content-disposition': `${attach ? 'attachment' : 'inline'}; filename="${name}"`,
      ...NO_STORE,
    },
  });
}

/** Every /stats/api/feedback* request, already authenticated by the caller. */
export async function handleFeedbackApi(req: Request, env: Env, url: URL, now: number): Promise<Response> {
  const rest = url.pathname.slice('/stats/api/feedback'.length);
  try {
    if (rest === '' || rest === '/') {
      if (req.method !== 'GET') return json({ error: 'method' }, 405);
      return json({ ...(await listFeedback(env.DB, parseFeedbackFilter(url))), open: await feedbackOpen(env) });
    }
    if (rest === '/count') return json({ new: await newCount(env.DB) });
    if (rest === '/switch') {
      if (req.method !== 'POST') return json({ open: await feedbackOpen(env) });
      const body = await readActionBody(req);
      if (body instanceof Response) return body;
      if (typeof body.open !== 'boolean') return json({ error: 'open' }, 400);
      await setFeedbackOpen(env.DB, body.open, now);
      return json({ open: await feedbackOpen(env) });
    }
    const m = /^\/(\d{1,9})(\/shot|\/replay)?$/.exec(rest);
    if (!m) return NOT_FOUND();
    const id = Number(m[1]);
    if (m[2] === undefined) {
      if (req.method === 'POST') {
        const body = await readActionBody(req);
        if (body instanceof Response) return body;
        const res = await applyFeedbackAction(env, id, body, now);
        return res.ok ? json({ status: res.status }) : json({ error: res.error }, res.code);
      }
      const d = await feedbackDetail(env, id, url.origin);
      return d ? json(d) : NOT_FOUND();
    }
    return serveAttachment(env, id, m[2] === '/shot' ? 'shot' : 'replay', url.searchParams.has('download'));
  } catch {
    return json({ error: 'storage' }, 503); // e.g. migration 0003 not applied yet
  }
}

/** Retention (spec §7, D15): 180 days after receipt the picture, the replay
 *  and the contact go; the note and context stay, like telemetry events.
 *  Run daily by the Cron Trigger in wrangler.jsonc. Returns rows purged. */
export const RETENTION_MS = 180 * 86_400_000;
export async function purgeExpired(env: Env, now: number, batch = 100, maxBatches = 10): Promise<number> {
  let purged = 0;
  for (let i = 0; i < maxBatches; i++) {
    const rows = await env.DB.prepare(
      `SELECT id FROM feedback WHERE received_at < ?
       AND (shot_bytes IS NOT NULL OR replay_bytes IS NOT NULL OR contact IS NOT NULL) ORDER BY id LIMIT ?`
    )
      .bind(now - RETENTION_MS, batch)
      .all<{ id: number }>();
    if (rows.results.length === 0) break;
    await env.DB.batch(
      rows.results.flatMap((r) => [
        env.DB.prepare('DELETE FROM feedback_picture WHERE feedback_id = ?').bind(r.id),
        env.DB.prepare('DELETE FROM feedback_replay WHERE feedback_id = ?').bind(r.id),
        env.DB.prepare('UPDATE feedback SET shot_bytes = NULL, replay_bytes = NULL, contact = NULL WHERE id = ?').bind(r.id),
      ])
    );
    purged += rows.results.length;
    if (rows.results.length < batch) break;
  }
  return purged;
}
