/**
 * POST /api/feedback and GET /api/feedback (GH-464, spec §5.2 plus the lead's
 * 2026-10-08 rulings: open to EVERY player in v1, so this is a public write
 * endpoint and is built like one).
 *
 * Unlike /api/events (always 204), the player is told whether the note landed:
 *   201 {"ref":"FB-0042","id":42}    stored
 *   400 {"error":"<reason>"}         malformed, or a part the source may not send
 *   403 {"error":"origin"}           not the site's own Origin (no null allowance)
 *   405                              any method but GET/POST
 *   410 {"error":"closed"}           the kill switch is on (env FEEDBACK_CLOSED or D1 flags.feedback)
 *   413 {"error":"too large"}        a cap was exceeded (declared or actual)
 *   429 {"retryAfter":<seconds>}     a rate limit (IP, session, player or global)
 *   503 {"error":"storage"}          D1 or R2 failed; nothing is left behind
 * GET answers 200 {"open":true|false} so the app can hide its entry points
 * when the switch is off, without an app deploy.
 *
 * Order matters and each step is cheaper than the next: switch, origin, IP
 * limit, declared size, a size-capped read, parse and validate, the D1-counted
 * limits, then R2 and finally the row. No IP is ever stored.
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
 *  flood from filling R2 whatever ids it invents. */
export const FEEDBACK_LIMITS = {
  session: { max: 10, windowMs: HOUR },
  player: { max: 20, windowMs: DAY },
  global: { max: 500, windowMs: DAY },
} as const;

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

export type ShotType = 'image/webp' | 'image/jpeg';
/** The picture's type from its first bytes, never from what the client says. */
export function sniffShot(b: Uint8Array): ShotType | null {
  const ascii = (from: number, s: string): boolean => [...s].every((ch, i) => b[from + i] === ch.charCodeAt(0));
  if (b.length >= 12 && ascii(0, 'RIFF') && ascii(8, 'WEBP')) return 'image/webp';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  return null;
}

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

interface Parts {
  meta: FeedbackMeta;
  shot: { bytes: Uint8Array; type: ShotType } | null;
  replay: Uint8Array | null;
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

  let shot: Parts['shot'] = null;
  const rawShot = form.get('shot');
  if (rawShot !== null) {
    if (typeof rawShot === 'string') return bad('shot is not a file');
    if (m.source !== 'pause') return bad('shot only from the pause form');
    if (rawShot.size > SHOT_MAX_BYTES) return TOO_LARGE();
    const bytes = new Uint8Array(await rawShot.arrayBuffer());
    if (bytes.byteLength > SHOT_MAX_BYTES) return TOO_LARGE();
    const type = sniffShot(bytes);
    if (type === null) return bad('shot is not WebP or JPEG');
    if (rawShot.type !== '' && rawShot.type !== type) return bad('shot type does not match its bytes');
    shot = { bytes, type };
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
  return { meta: m, shot, replay };
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
  const { meta, shot, replay } = parts;

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

  // R2 first, under a random prefix (the row id does not exist yet), then the
  // row. A row never points at an object that failed to land; an object
  // whose row failed is deleted, best effort.
  const keys: string[] = [];
  let shotKey: string | null = null;
  let logKey: string | null = null;
  if (shot !== null || replay !== null) {
    const blobs = env.FEEDBACK_BLOBS;
    if (!blobs) return STORAGE();
    const prefix = `fb/${crypto.randomUUID()}`;
    try {
      if (shot !== null) {
        shotKey = `${prefix}/shot.${shot.type === 'image/webp' ? 'webp' : 'jpg'}`;
        keys.push(shotKey);
        await blobs.put(shotKey, shot.bytes, { httpMetadata: { contentType: shot.type } });
      }
      if (replay !== null) {
        logKey = `${prefix}/replay.json`;
        keys.push(logKey);
        await blobs.put(logKey, replay, { httpMetadata: { contentType: 'application/json' } });
      }
    } catch {
      await blobs.delete(keys).catch(() => undefined);
      return STORAGE();
    }
  }

  try {
    const row = await env.DB.prepare(
      `INSERT INTO feedback (received_at, t, player, session, tester, build, "commit", source, category, rating, text,
         contact, mission, map, tick, context, shot_key, log_key, dev, status, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?) RETURNING id`
    )
      .bind(
        now, meta.t, meta.player ?? null, meta.session ?? null, meta.tester ?? null, meta.build, meta.commit ?? null,
        meta.source, meta.category, meta.rating ?? null, meta.text, meta.contact ?? null, meta.mission ?? null,
        meta.map ?? null, meta.tick ?? null, JSON.stringify(meta.context), shotKey, logKey, meta.dev ? 1 : 0, now
      )
      .first<{ id: number }>();
    if (!row) throw new Error('no id');
    return reply(201, { ref: feedbackRef(row.id), id: row.id });
  } catch {
    if (keys.length > 0) await env.FEEDBACK_BLOBS?.delete(keys).catch(() => undefined);
    return STORAGE();
  }
}

