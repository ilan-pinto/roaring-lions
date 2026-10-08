import { describe, it, expect } from 'vitest';
import { handleFeedback, sniffShot } from './feedback-ingest';
import { setFeedbackOpen } from './feedback-triage';
import { openTestD1 } from './test-d1';
import { openTestR2 } from './test-r2';
import type { Env, RateLimiter } from './d1';

const ORIGIN = 'https://game.example.workers.dev';
const NOW = 1_790_000_000_000;
const P = '0f8fad5b-d9cb-469f-a165-70867728950e';
const S = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const META = {
  v: 1,
  t: NOW - 5000,
  source: 'pause',
  category: 'bug',
  text: 'The rifle squad walked to the far wall.',
  build: '0.122.0',
  commit: '41bc520b',
  player: P,
  session: S,
  tester: 'dana',
  mission: 'beit_sahwan_2_foothold',
  map: 'beit_sahwan_outskirts',
  tick: 467,
  context: { renderer: 'three', quality: 'high', gpu: 'ANGLE Metal', viewport: [1920, 1080], dpr: 2, locale: 'en' },
};
const WEBP = (n = 64): Uint8Array<ArrayBuffer> => {
  const b = new Uint8Array(n);
  b.set(new TextEncoder().encode('RIFF'), 0);
  b.set(new TextEncoder().encode('WEBP'), 8);
  return b;
};
const JPEG = (n = 64): Uint8Array<ArrayBuffer> => {
  const b = new Uint8Array(n);
  b.set([0xff, 0xd8, 0xff, 0xe0]);
  return b;
};
const PNG = (): Uint8Array<ArrayBuffer> => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
// The caps and limits as the spec states them (§5.2, §7) -- literals, never
// imported from the code under test, so a drifted constant goes red here.
const BODY_MAX_BYTES = 448 * 1024;
const SHOT_MAX_BYTES = 300 * 1024;
const REPLAY_MAX_BYTES = 96 * 1024;
const IP_LIMIT_RETRY_SECONDS = 60;
const FEEDBACK_LIMITS = {
  session: { max: 10, windowMs: 3_600_000 },
  player: { max: 20, windowMs: 86_400_000 },
  global: { max: 500, windowMs: 86_400_000 },
};
const REPLAY = JSON.stringify({ v: 1, commands: [{ tick: 3, cmd: { k: 'move' } }], hash: '0x5e21a9c3', tick: 467 });

interface Opts {
  meta?: unknown;
  shot?: { bytes: Uint8Array<ArrayBuffer>; type?: string } | null;
  replay?: string | null;
  extra?: [string, string][];
  headers?: Record<string, string>;
}

function setup(over: Partial<Env> = {}) {
  const db = openTestD1();
  const r2 = openTestR2();
  const env: Env = { DB: db, ASSETS: { fetch: async () => new Response('') }, FEEDBACK_BLOBS: r2, ...over };
  const form = (o: Opts): FormData => {
    const f = new FormData();
    f.set('meta', typeof o.meta === 'string' ? o.meta : JSON.stringify(o.meta ?? META));
    if (o.shot) f.set('shot', new Blob([o.shot.bytes], { type: o.shot.type ?? 'image/webp' }), 'shot.webp');
    if (o.replay) f.set('replay', new Blob([o.replay], { type: 'application/json' }), 'replay.json');
    for (const [k, v] of o.extra ?? []) f.append(k, v);
    return f;
  };
  const post = (o: Opts = {}, now = NOW) =>
    handleFeedback(
      new Request(`${ORIGIN}/api/feedback`, {
        method: 'POST',
        body: form(o),
        headers: { origin: ORIGIN, 'cf-connecting-ip': '203.0.113.9', ...o.headers },
      }),
      env,
      now
    );
  const get = () => handleFeedback(new Request(`${ORIGIN}/api/feedback`), env, NOW);
  const rows = () => db.raw.prepare('SELECT * FROM feedback ORDER BY id').all() as Record<string, unknown>[];
  /** Inserts `n` rows straight into D1, for the counted limits. */
  const seed = (n: number, cols: { player?: string | null; session?: string | null }, at: number) => {
    const ins = db.raw.prepare(
      `INSERT INTO feedback (received_at, t, player, session, build, source, category, text, context, updated_at)
       VALUES (?, ?, ?, ?, '0.1.0', 'pause', 'idea', 'x', '{}', ?)`
    );
    for (let i = 0; i < n; i++) ins.run(at, at, cols.player ?? null, cols.session ?? null, at);
  };
  return { db, r2, env, post, get, rows, seed };
}

const errorOf = async (r: Response) => ((await r.json()) as { error?: string; retryAfter?: number });

describe('POST /api/feedback: a valid note', () => {
  it('answers 201 with a reference, stores the row as new, and puts the picture and replay in R2 under sniffed types', async () => {
    const h = setup();
    const res = await h.post({ shot: { bytes: WEBP() }, replay: REPLAY });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ref: 'FB-0001', id: 1 });
    const [row] = h.rows();
    expect(row).toMatchObject({ status: 'new', category: 'bug', tester: 'dana', player: P, session: S, mission: 'beit_sahwan_2_foothold', tick: 467, received_at: NOW, dev: 0 });
    expect(String(row.shot_key)).toMatch(/^fb\/[0-9a-f-]{36}\/shot\.webp$/);
    expect(String(row.log_key)).toMatch(/^fb\/[0-9a-f-]{36}\/replay\.json$/);
    expect(h.r2.objects.get(String(row.shot_key))?.contentType).toBe('image/webp');
    expect(h.r2.objects.get(String(row.log_key))?.contentType).toBe('application/json');
  });

  it('a JPEG is stored as .jpg / image/jpeg, whatever extension the client used', async () => {
    const h = setup();
    expect((await h.post({ shot: { bytes: JPEG(), type: 'image/jpeg' } })).status).toBe(201);
    expect(String(h.rows()[0].shot_key)).toMatch(/shot\.jpg$/);
  });

  it('an anonymous note (opt-out) stores NULL identity, and a debrief rating needs no text', async () => {
    const h = setup();
    const anon = { ...META, player: undefined, session: undefined, tester: undefined };
    expect((await h.post({ meta: { ...anon, source: 'debrief', category: 'rating', rating: 2, text: '' } })).status).toBe(201);
    expect(h.rows()[0]).toMatchObject({ player: null, session: null, tester: null, rating: 2, text: '' });
  });

  it('never stores the IP', async () => {
    const h = setup();
    await h.post();
    expect(JSON.stringify(h.rows())).not.toContain('203.0.113.9');
  });

  it('GET answers {"open":true} while the switch is open', async () => {
    expect(await (await setup().get()).json()).toEqual({ open: true });
  });

  it('any method but GET/POST is 405', async () => {
    const h = setup();
    expect((await handleFeedback(new Request(`${ORIGIN}/api/feedback`, { method: 'PUT', body: 'x' }), h.env, NOW)).status).toBe(405);
  });
});

describe('POST /api/feedback: caps', () => {
  it('a declared Content-Length over 448 KB is 413 before the body is read', async () => {
    const h = setup();
    const res = await h.post({ headers: { 'content-length': String(BODY_MAX_BYTES + 1) } });
    expect(res.status).toBe(413);
    expect(h.rows()).toHaveLength(0);
  });

  it('a body over 448 KB with no Content-Length is cut off at the cap and refused 413', async () => {
    const h = setup();
    const chunk = new Uint8Array(64 * 1024);
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        if (sent > BODY_MAX_BYTES + chunk.length) return c.close();
        sent += chunk.length;
        c.enqueue(chunk);
      },
    });
    const req = new Request(`${ORIGIN}/api/feedback`, {
      method: 'POST',
      body,
      headers: { origin: ORIGIN, 'content-type': 'multipart/form-data; boundary=x' },
      duplex: 'half',
    } as RequestInit);
    expect((await handleFeedback(req, h.env, NOW)).status).toBe(413);
  });

  it('a picture over 300 KB is 413; exactly 300 KB is accepted', async () => {
    const h = setup();
    expect((await h.post({ shot: { bytes: WEBP(SHOT_MAX_BYTES + 1) } })).status).toBe(413);
    expect((await h.post({ shot: { bytes: WEBP(SHOT_MAX_BYTES) } })).status).toBe(201);
  });

  it('a replay over 96 KB is 413; exactly 96 KB is accepted', async () => {
    const h = setup();
    const pad = (n: number) => JSON.stringify({ commands: [], pad: 'x'.repeat(n - '{"commands":[],"pad":""}'.length) });
    expect(pad(REPLAY_MAX_BYTES)).toHaveLength(REPLAY_MAX_BYTES);
    expect((await h.post({ replay: pad(REPLAY_MAX_BYTES + 1) })).status).toBe(413);
    expect((await h.post({ replay: pad(REPLAY_MAX_BYTES) })).status).toBe(201);
  });

  it('a meta part over 24 KB is 413', async () => {
    const h = setup();
    expect((await h.post({ meta: JSON.stringify(META) + ' '.repeat(24 * 1024) })).status).toBe(413);
  });

  it('text over 2000 characters, a line over 280, contact over 120 and context over 8 KB are 400', async () => {
    const h = setup();
    expect((await h.post({ meta: { ...META, text: 'x'.repeat(2001) } })).status).toBe(400);
    expect((await h.post({ meta: { ...META, text: 'x'.repeat(2000) } })).status).toBe(201);
    expect((await h.post({ meta: { ...META, source: 'debrief', category: 'rating', rating: 3, text: 'x'.repeat(281) } })).status).toBe(400);
    expect((await h.post({ meta: { ...META, contact: 'x'.repeat(121) } })).status).toBe(400);
    expect((await h.post({ meta: { ...META, context: { feed: ['x'.repeat(8200)] } } })).status).toBe(400);
    expect(h.rows()).toHaveLength(1);
  });
});

describe('POST /api/feedback: validation', () => {
  it('the picture type comes from its bytes: PNG, or a WebP labelled JPEG, is 400', async () => {
    const h = setup();
    expect(await errorOf(await h.post({ shot: { bytes: PNG(), type: 'image/png' } }))).toEqual({ error: 'shot is not WebP or JPEG' });
    expect((await h.post({ shot: { bytes: WEBP(), type: 'image/jpeg' } })).status).toBe(400);
    expect(sniffShot(WEBP())).toBe('image/webp');
    expect(sniffShot(JPEG())).toBe('image/jpeg');
  });

  it('a replay is accepted only with a bug from the pause form; a picture only from the pause form', async () => {
    const h = setup();
    expect((await h.post({ meta: { ...META, category: 'idea' }, replay: REPLAY })).status).toBe(400);
    expect((await h.post({ meta: { ...META, source: 'menu' }, replay: REPLAY })).status).toBe(400);
    expect((await h.post({ meta: { ...META, source: 'menu' }, shot: { bytes: WEBP() } })).status).toBe(400);
    expect((await h.post({ replay: '[1,2]' })).status).toBe(400);
    expect((await h.post({ replay: 'not json' })).status).toBe(400);
    expect(h.rows()).toHaveLength(0);
    expect(h.r2.objects.size).toBe(0);
  });

  it('an unknown part, a duplicated part, a missing meta, bad JSON, an unknown field and a rating outside the debrief are 400', async () => {
    const h = setup();
    expect((await h.post({ extra: [['note', 'x']] })).status).toBe(400);
    expect((await h.post({ extra: [['meta', '{}']] })).status).toBe(400);
    expect((await h.post({ meta: '{' })).status).toBe(400);
    expect((await h.post({ meta: { ...META, email: 'x@y.z' } })).status).toBe(400);
    expect((await h.post({ meta: { ...META, rating: 4 } })).status).toBe(400);
    expect((await h.post({ meta: { ...META, source: 'debrief' } })).status).toBe(400);
    const noMeta = new FormData();
    noMeta.set('shot', new Blob([WEBP()]));
    const res = await handleFeedback(new Request(`${ORIGIN}/api/feedback`, { method: 'POST', body: noMeta, headers: { origin: ORIGIN } }), h.env, NOW);
    expect(res.status).toBe(400);
    expect(h.rows()).toHaveLength(0);
  });

  it('a JSON body (not multipart) is 400', async () => {
    const h = setup();
    const req = new Request(`${ORIGIN}/api/feedback`, { method: 'POST', body: JSON.stringify(META), headers: { origin: ORIGIN, 'content-type': 'application/json' } });
    expect((await handleFeedback(req, h.env, NOW)).status).toBe(400);
  });

  it('a missing or foreign Origin is 403 (no null allowance: this is a fetch, not a beacon)', async () => {
    const h = setup();
    expect((await h.post({ headers: { origin: 'https://evil.example' } })).status).toBe(403);
    const f = new FormData();
    f.set('meta', JSON.stringify(META));
    expect((await handleFeedback(new Request(`${ORIGIN}/api/feedback`, { method: 'POST', body: f }), h.env, NOW)).status).toBe(403);
    expect(h.rows()).toHaveLength(0);
  });
});

describe('POST /api/feedback: rate limits', () => {
  it('the per-IP binding refusing is 429 with retryAfter 60, and nothing is stored', async () => {
    const keys: string[] = [];
    const limiter: RateLimiter = { limit: async ({ key }) => (keys.push(key), { success: false }) };
    const h = setup({ FEEDBACK_LIMIT: limiter });
    const res = await h.post({ shot: { bytes: WEBP() } });
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ retryAfter: IP_LIMIT_RETRY_SECONDS });
    expect(keys).toEqual(['203.0.113.9']);
    expect(h.rows()).toHaveLength(0);
    expect(h.r2.objects.size).toBe(0);
  });

  it('per session: the 11th note inside an hour is 429, with the wait until the oldest ages out', async () => {
    const h = setup();
    const { max, windowMs } = FEEDBACK_LIMITS.session;
    h.seed(max, { session: S, player: '00000000-0000-4000-8000-000000000001' }, NOW - 1000);
    const res = await h.post();
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ retryAfter: Math.ceil((windowMs - 1000) / 1000) });
    // The same count from ANOTHER session is not this session's problem.
    expect((await h.post({ meta: { ...META, session: '7c9e6679-7425-40de-944b-e07fc1f90ae8' } })).status).toBe(201);
    // ...and once the window has passed, this session may send again.
    expect((await h.post({}, NOW + windowMs)).status).toBe(201);
  });

  it('per player: the 21st note inside a day is 429', async () => {
    const h = setup();
    h.seed(FEEDBACK_LIMITS.player.max, { player: P }, NOW - 60_000);
    expect((await h.post({ meta: { ...META, session: undefined } })).status).toBe(429);
    h.db.raw.exec('DELETE FROM feedback WHERE id = 1');
    expect((await h.post({ meta: { ...META, session: undefined } })).status).toBe(201);
  });

  it('global: the 501st note in a day is 429 whatever ids it carries (a flood cannot fill R2)', async () => {
    const h = setup();
    h.seed(FEEDBACK_LIMITS.global.max, {}, NOW - 60_000);
    const anon = { ...META, player: undefined, session: undefined, tester: undefined };
    expect((await h.post({ meta: anon, shot: { bytes: WEBP() } })).status).toBe(429);
    expect(h.r2.objects.size).toBe(0);
  });
});

describe('POST /api/feedback: the kill switch', () => {
  it('env FEEDBACK_CLOSED closes it: POST 410, GET {"open":false}, nothing stored', async () => {
    const h = setup({ FEEDBACK_CLOSED: '1' });
    const res = await h.post({ shot: { bytes: WEBP() } });
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({ error: 'closed' });
    expect(await (await h.get()).json()).toEqual({ open: false });
    expect(h.rows()).toHaveLength(0);
    expect(h.r2.objects.size).toBe(0);
  });

  it('FEEDBACK_CLOSED "0", "false" or empty leaves it open', async () => {
    for (const v of ['0', 'false', '', ' ']) expect((await setup({ FEEDBACK_CLOSED: v }).post()).status).toBe(201);
  });

  it('the D1 flag closes it without any deploy, and reopening restores it', async () => {
    const h = setup();
    await setFeedbackOpen(h.db, false, NOW);
    expect((await h.post()).status).toBe(410);
    expect(await (await h.get()).json()).toEqual({ open: false });
    await setFeedbackOpen(h.db, true, NOW);
    expect((await h.post()).status).toBe(201);
  });

  it('the switch is checked before the origin, so a closed endpoint says closed to everyone', async () => {
    const h = setup({ FEEDBACK_CLOSED: 'true' });
    expect((await h.post({ headers: { origin: 'https://evil.example' } })).status).toBe(410);
  });
});

describe('POST /api/feedback: storage failures leave nothing behind', () => {
  it('an R2 put failure is 503 and no row is written', async () => {
    const h = setup();
    h.r2.fail.put = true;
    expect((await h.post({ shot: { bytes: WEBP() }, replay: REPLAY })).status).toBe(503);
    expect(h.rows()).toHaveLength(0);
  });

  it('a row failure after R2 succeeded is 503 and the objects are deleted again', async () => {
    const h = setup();
    h.db.raw.exec('CREATE TRIGGER no_rows BEFORE INSERT ON feedback BEGIN SELECT RAISE(ABORT, "boom"); END');
    expect((await h.post({ shot: { bytes: WEBP() }, replay: REPLAY })).status).toBe(503);
    expect(h.r2.objects.size).toBe(0);
  });

  it('an attachment with no bucket bound is 503, not a row pointing nowhere', async () => {
    const h = setup({ FEEDBACK_BLOBS: undefined });
    expect((await h.post({ shot: { bytes: WEBP() } })).status).toBe(503);
    expect(h.rows()).toHaveLength(0);
  });

  it('the migration not applied (no tables) is 503 on POST and GET', async () => {
    const h = setup();
    h.db.raw.exec('DROP TABLE flags');
    expect((await h.post()).status).toBe(503);
    expect((await h.get()).status).toBe(503);
  });
});
