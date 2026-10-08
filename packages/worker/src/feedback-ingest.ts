/**
 * POST /api/feedback and GET /api/feedback (GH-464, spec §5.2 plus the lead's
 * 2026-10-08 rulings: open to EVERY player in v1, so this is a public write
 * endpoint and is built like one).
 *
 * Unlike /api/events (always 204), the player is told whether the note landed:
 *   201 {"ref":"FB-0042","id":42}    stored, attachments included
 *   201 {"ref":…,"id":…,"dropped":{"picture":"too_large"}}
 *                                    stored WITHOUT the picture: it was over 64 KB.
 *                                    `dropped` can also carry "storage_full" for
 *                                    the picture and/or the replay (the D1 budget)
 *   400 {"error":"<reason>"}         malformed, a picture that is not WebP, or a part the source may not send
 *   403 {"error":"origin"}           not the site's own Origin (no null allowance)
 *   405                              any method but GET/POST
 *   410 {"error":"closed"}           the kill switch is on (env FEEDBACK_CLOSED or D1 flags.feedback)
 *   413 {"error":"too large"}        a cap was exceeded (declared or actual)
 *   429 {"retryAfter":<seconds>}     a rate limit (IP, session, player or global)
 *   503 {"error":"storage"}          D1 failed; nothing is left behind
 * GET answers 200 {"open":true|false} so the app can hide its entry points
 * when the switch is off, without an app deploy.
 *
 * Order matters and each step is cheaper than the next: switch, origin, IP
 * limit, declared size, a size-capped read, parse and validate, the D1-counted
 * limits, then the row and its attachments. Everything lives in D1 (the lead's
 * 2026-10-08 ruling); the picture and replay sit in their own tables so the
 * list never reads a blob. No IP is ever stored.
 */
import type { Env } from './d1';
import {
  BODY_MAX_BYTES,
  META_MAX_BYTES,
  REPLAY_MAX_BYTES,
  SHOT_MAX_BYTES,
  feedbackMetaProblem,
  feedbackRef,
  type FeedbackMeta,
} from './feedback-meta';

export const IP_LIMIT_RETRY_SECONDS = 60;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** The D1-counted limits, all on `received_at`. A session is one tab's run of
 *  the game; a player is one browser; `global` is the ceiling that stops a
 *  flood from filling D1 whatever ids it invents. */
export const FEEDBACK_LIMITS = {
  session: { max: 10, windowMs: HOUR },
  player: { max: 20, windowMs: DAY },
  global: { max: 500, windowMs: DAY },
} as const;

/** What attachments may add to D1, which is also the telemetry store (free
 *  tier 500 MB). Past either budget a note still lands, without its
 *  attachments, and the 201 says so. Retention (180 days) frees space. */
export const ATTACHMENT_BUDGET = { dayBytes: 16 * 1024 * 1024, totalBytes: 200 * 1024 * 1024 } as const;

const NO_STORE = { 'cache-control': 'no-store' } as const;
const reply = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...NO_STORE } });
const bad = (error: string): Response => reply(400, { error });
const TOO_LARGE = (): Response => reply(413, { error: 'too large' });
const STORAGE = (): Response => reply(503, { error: 'storage' });

/** The kill switch. The env half is read first and needs no database. */
export async function feedbackOpen(env: Env): Promise<boolean> {
  const v = (env.FEEDBACK_CLOSED ?? '').trim().toLowerCase();
  if (v !== '' && v !== '0' && v !== 'false') return false;
  const row = await env.DB.prepare(`SELECT value FROM flags WHERE name = 'feedback'`).first<{ value: string }>();
  return row?.value !== 'closed';
}

function originAllowed(req: Request, env: Env): boolean {
  const origin = req.headers.get('origin');
  if (origin === null) return false; // a fetch from the page always sends one
  const own = new URL(req.url).origin;
  const extra = (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return origin === own || extra.includes(origin);
}

/** Reads at most `max` bytes; null if the body is longer. A lying or absent
 *  Content-Length cannot make this buffer more than `max` + one chunk. */
async function readCapped(req: Request, max: number): Promise<Uint8Array<ArrayBuffer> | null> {
  if (!req.body) return new Uint8Array(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

/** WebP from its first bytes, never from what the client says. WebP only:
 *  a JPEG of the same frame is about twice the size (spec §4.2). */
export function isWebp(b: Uint8Array): boolean {
  const ascii = (from: number, s: string): boolean => [...s].every((ch, i) => b[from + i] === ch.charCodeAt(0));
  return b.length >= 12 && ascii(0, 'RIFF') && ascii(8, 'WEBP');
}

export type DropReason = 'too_large' | 'storage_full';

/** The Nth-newest row inside a window, or null when under the limit. */
async function limitedFor(env: Env, column: 'session' | 'player' | null, value: string | undefined, max: number, windowMs: number, now: number): Promise<number | null> {
  if (column !== null && value === undefined) return null;
  const sql = column === null
    ? 'SELECT received_at FROM feedback WHERE received_at > ? ORDER BY received_at DESC LIMIT 1 OFFSET ?'
    : `SELECT received_at FROM feedback WHERE ${column} = ? AND received_at > ? ORDER BY received_at DESC LIMIT 1 OFFSET ?`;
  const args = column === null ? [now - windowMs, max - 1] : [value, now - windowMs, max - 1];
  const row = await env.DB.prepare(sql).bind(...args).first<{ received_at: number }>();
  if (!row) return null;
  return Math.max(1, Math.ceil((row.received_at + windowMs - now) / 1000));
}

/** Whether `want` more attachment bytes stay inside both D1 budgets. */
async function attachmentsFit(env: Env, want: number, now: number): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT COALESCE(SUM(COALESCE(shot_bytes, 0) + COALESCE(replay_bytes, 0)), 0) AS total,
            COALESCE(SUM(CASE WHEN received_at > ? THEN COALESCE(shot_bytes, 0) + COALESCE(replay_bytes, 0) ELSE 0 END), 0) AS day
     FROM feedback WHERE shot_bytes IS NOT NULL OR replay_bytes IS NOT NULL`
  )
    .bind(now - DAY)
    .first<{ total: number; day: number }>();
  const total = row?.total ?? 0;
  const day = row?.day ?? 0;
  return day + want <= ATTACHMENT_BUDGET.dayBytes && total + want <= ATTACHMENT_BUDGET.totalBytes;
}

interface Parts {
  meta: FeedbackMeta;
  shot: Uint8Array | null;
  replay: Uint8Array | null;
  dropped: { picture?: DropReason; replay?: DropReason };
}

const partBytes = async (v: FormDataEntryValue): Promise<Uint8Array> =>
  typeof v === 'string' ? new TextEncoder().encode(v) : new Uint8Array(await v.arrayBuffer());

/** Either the parsed parts or the Response that refuses them. */
async function parseParts(form: FormData): Promise<Parts | Response> {
  for (const k of new Set(form.keys())) {
    if (k !== 'meta' && k !== 'shot' && k !== 'replay') return bad(`unknown part ${k}`);
    if (form.getAll(k).length !== 1) return bad(`more than one ${k}`);
  }
  const rawMeta = form.get('meta');
  if (rawMeta === null) return bad('meta missing');
  const metaBytes = await partBytes(rawMeta);
  if (metaBytes.byteLength > META_MAX_BYTES) return TOO_LARGE();
  let meta: unknown;
  try {
    meta = JSON.parse(new TextDecoder().decode(metaBytes));
  } catch {
    return bad('meta is not JSON');
  }
  const problem = feedbackMetaProblem(meta);
  if (problem !== null) return bad(problem);
  const m = meta as FeedbackMeta;

  let shot: Uint8Array | null = null;
  const dropped: Parts['dropped'] = {};
  const rawShot = form.get('shot');
  if (rawShot !== null) {
    if (typeof rawShot === 'string') return bad('shot is not a file');
    if (m.source !== 'pause') return bad('shot only from the pause form');
    if (rawShot.type !== '' && rawShot.type !== 'image/webp') return bad('shot is not WebP');
    // Over the cap: the NOTE still lands and the 201 says the picture did
    // not (the lead's ruling: "picture too large, sent without it").
    if (rawShot.size > SHOT_MAX_BYTES) dropped.picture = 'too_large';
    else {
      const bytes = new Uint8Array(await rawShot.arrayBuffer());
      if (!isWebp(bytes)) return bad('shot is not WebP');
      shot = bytes;
    }
  }

  let replay: Uint8Array | null = null;
  const rawReplay = form.get('replay');
  if (rawReplay !== null) {
    if (m.category !== 'bug' || m.source !== 'pause') return bad('replay only with a bug from the pause form');
    const bytes = await partBytes(rawReplay);
    if (bytes.byteLength > REPLAY_MAX_BYTES) return TOO_LARGE();
    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      return bad('replay is not JSON');
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return bad('replay is not an object');
    replay = bytes;
  }
  return { meta: m, shot, replay, dropped };
}

export async function handleFeedback(req: Request, env: Env, now: number): Promise<Response> {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return new Response(null, { status: 405, headers: { allow: 'GET, POST', ...NO_STORE } });
  }
  let open: boolean;
  try {
    open = await feedbackOpen(env);
  } catch {
    return STORAGE(); // the migration is not applied yet: closed, loudly
  }
  if (req.method === 'GET') return reply(200, { open });
  if (!open) return reply(410, { error: 'closed' });

  if (!originAllowed(req, env)) return reply(403, { error: 'origin' });

  const ip = req.headers.get('cf-connecting-ip');
  if (env.FEEDBACK_LIMIT && ip) {
    const { success } = await env.FEEDBACK_LIMIT.limit({ key: ip }); // in memory in the binding, never stored
    if (!success) return reply(429, { retryAfter: IP_LIMIT_RETRY_SECONDS });
  }

  const declared = req.headers.get('content-length');
  if (declared !== null && Number(declared) > BODY_MAX_BYTES) return TOO_LARGE();
  const contentType = req.headers.get('content-type') ?? '';
  if (!/^multipart\/form-data;/i.test(contentType)) return bad('not multipart/form-data');
  const body = await readCapped(req, BODY_MAX_BYTES);
  if (body === null) return TOO_LARGE();
  let form: FormData;
  try {
    form = await new Response(body, { headers: { 'content-type': contentType } }).formData();
  } catch {
    return bad('unreadable multipart body');
  }
  const parts = await parseParts(form);
  if (parts instanceof Response) return parts;
  const { meta, dropped } = parts;
  let { shot, replay } = parts;

  try {
    const L = FEEDBACK_LIMITS;
    const wait =
      (await limitedFor(env, 'session', meta.session, L.session.max, L.session.windowMs, now)) ??
      (await limitedFor(env, 'player', meta.player, L.player.max, L.player.windowMs, now)) ??
      (await limitedFor(env, null, undefined, L.global.max, L.global.windowMs, now));
    if (wait !== null) return reply(429, { retryAfter: wait });
  } catch {
    return STORAGE();
  }

  try {
    const want = (shot?.byteLength ?? 0) + (replay?.byteLength ?? 0);
    if (want > 0 && !(await attachmentsFit(env, want, now))) {
      if (shot) dropped.picture = 'storage_full';
      if (replay) dropped.replay = 'storage_full';
      shot = null;
      replay = null;
    }
  } catch {
    return STORAGE();
  }

  // The row first (its id keys the attachments), then the attachments in one
  // batch. If the batch fails the row is deleted again: a note never claims
  // a picture or replay that is not there.
  let id: number;
  try {
    const row = await env.DB.prepare(
      `INSERT INTO feedback (received_at, t, player, session, tester, build, "commit", source, category, rating, text,
         contact, mission, map, tick, context, shot_bytes, replay_bytes, dev, status, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?) RETURNING id`
    )
      .bind(
        now, meta.t, meta.player ?? null, meta.session ?? null, meta.tester ?? null, meta.build, meta.commit ?? null,
        meta.source, meta.category, meta.rating ?? null, meta.text, meta.contact ?? null, meta.mission ?? null,
        meta.map ?? null, meta.tick ?? null, JSON.stringify(meta.context), shot?.byteLength ?? null,
        replay?.byteLength ?? null, meta.dev ? 1 : 0, now
      )
      .first<{ id: number }>();
    if (!row) throw new Error('no id');
    id = row.id;
  } catch {
    return STORAGE();
  }
  if (shot !== null || replay !== null) {
    const stmts = [];
    if (shot !== null) stmts.push(env.DB.prepare('INSERT INTO feedback_picture (feedback_id, bytes) VALUES (?, ?)').bind(id, shot));
    if (replay !== null) {
      stmts.push(env.DB.prepare('INSERT INTO feedback_replay (feedback_id, json) VALUES (?, ?)').bind(id, new TextDecoder().decode(replay)));
    }
    try {
      await env.DB.batch(stmts);
    } catch {
      await env.DB.prepare('DELETE FROM feedback WHERE id = ?').bind(id).run().catch(() => undefined);
      return STORAGE();
    }
  }
  const out: Record<string, unknown> = { ref: feedbackRef(id), id };
  if (dropped.picture || dropped.replay) out.dropped = dropped;
  return reply(201, out);
}

