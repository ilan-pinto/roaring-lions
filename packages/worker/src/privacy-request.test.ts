/** GH-1417 C1/C2/C5: the private privacy-request form, the `privacy` feedback category, security.txt. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import worker from './index';
import { handleFeedback } from './feedback-ingest';
import { setFeedbackOpen, feedbackDetail, applyFeedbackAction, purgeExpired } from './feedback-triage';
import { handleStats } from './stats';
import { FEEDBACK_HTML } from './feedback-page';
import { renderPrivacy, privacyValues, PRIVACY_CONTACT, PRIVACY_MIN_AGE } from './privacy-page';
import { PRIVACY_REQUEST_HTML } from './privacy-request';
import { openTestD1 } from './test-d1';
import { signSession, SESSION_COOKIE } from './auth';
import type { Env, RateLimiter } from './d1';

const ORIGIN = 'https://game.example.workers.dev';
const NOW = 1_790_000_000_000;
const SECRET = 'correct horse battery staple';
const WEBP = (() => {
  const b = new Uint8Array(32);
  b.set(new TextEncoder().encode('RIFF'), 0);
  b.set(new TextEncoder().encode('WEBP'), 8);
  return b;
})();
const META = {
  v: 1, t: NOW - 1000, source: 'privacy', category: 'privacy',
  text: 'Request: deletion\nAccount: Dana #1234\n\nPlease delete my account.', build: '0.0.0', context: {}, contact: 'dana on Discord',
};

function setup(over: Partial<Env> = {}) {
  const db = openTestD1();
  const env: Env = { DB: db, ASSETS: { fetch: async () => new Response('') }, STATS_PASSWORD: SECRET, ...over };
  const post = (meta: unknown = META, ip = '203.0.113.9', extra: (f: FormData) => void = () => undefined) => {
    const f = new FormData();
    f.set('meta', JSON.stringify(meta));
    extra(f);
    return handleFeedback(new Request(`${ORIGIN}/api/feedback`, { method: 'POST', body: f, headers: { origin: ORIGIN, 'cf-connecting-ip': ip } }), env, NOW);
  };
  const stats = async (path: string, auth = true) => {
    const headers = new Headers();
    if (auth) headers.set('cookie', `${SESSION_COOKIE}=${await signSession(SECRET, NOW + 3_600_000)}`);
    return handleStats(new Request(`${ORIGIN}${path}`, { headers }), env, NOW);
  };
  return { db, env, post, stats };
}

describe('the privacy category on POST /api/feedback', () => {
  it('is stored as an ordinary new row with source and category privacy, and no attachment', async () => {
    const h = setup();
    const res = await h.post();
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ref: 'FB-0001', id: 1 });
    expect(h.db.raw.prepare('SELECT source, category, status, text, contact, player, session, tester FROM feedback').all()).toEqual([
      { source: 'privacy', category: 'privacy', status: 'new', text: META.text, contact: 'dana on Discord', player: null, session: null, tester: null },
    ]);
  });

  it('is refused from any other source, and no other category may use the privacy source; no picture, no replay', async () => {
    const h = setup();
    expect((await h.post({ ...META, source: 'menu' })).status).toBe(400);
    expect((await h.post({ ...META, source: 'pause' })).status).toBe(400);
    expect((await h.post({ ...META, category: 'idea' })).status).toBe(400);
    expect((await h.post({ ...META, rating: 3 })).status).toBe(400);
    expect((await h.post(META, '203.0.113.9', (f) => f.set('shot', new Blob([WEBP], { type: 'image/webp' })))).status).toBe(400);
    expect((await h.post(META, '203.0.113.9', (f) => f.set('replay', new Blob(['{}'])))).status).toBe(400);
    expect(h.db.raw.prepare('SELECT COUNT(*) AS n FROM feedback').get()).toEqual({ n: 0 });
    // the same real WebP IS accepted from the pause form, so the refusal above is about the source and not the bytes
    expect((await h.post({ ...META, source: 'pause', category: 'idea', contact: undefined }, '203.0.113.10', (f) => f.set('shot', new Blob([WEBP], { type: 'image/webp' })))).status).toBe(201);
  });

  it('keeps the caps: text over 2000 is 400, a foreign Origin is 403', async () => {
    const h = setup();
    expect((await h.post({ ...META, text: 'x'.repeat(2001) })).status).toBe(400);
    const f = new FormData();
    f.set('meta', JSON.stringify(META));
    const res = await handleFeedback(new Request(`${ORIGIN}/api/feedback`, { method: 'POST', body: f, headers: { origin: 'https://evil.example' } }), h.env, NOW);
    expect(res.status).toBe(403);
  });

  it('is rate limited like any note: the per-IP binding, and the 10 a day from one address', async () => {
    const limited = setup({ FEEDBACK_LIMIT: { limit: async () => ({ success: false }) } as RateLimiter });
    expect((await limited.post()).status).toBe(429);
    const h = setup({ IP_HASH_SECRET: 'k' } as Partial<Env>);
    const codes: number[] = [];
    for (let i = 0; i < 11; i++) codes.push((await h.post()).status);
    expect(codes.filter((c) => c === 201)).toHaveLength(10);
    expect(codes[10]).toBe(429);
  });

  it('obeys the kill switch: env FEEDBACK_CLOSED and the D1 flag both answer 410 and store nothing', async () => {
    const a = setup({ FEEDBACK_CLOSED: '1' });
    expect((await a.post()).status).toBe(410);
    const b = setup();
    await setFeedbackOpen(b.env.DB, false, NOW);
    expect((await b.post()).status).toBe(410);
    for (const h of [a, b]) expect(h.db.raw.prepare('SELECT COUNT(*) AS n FROM feedback').get()).toEqual({ n: 0 });
  });
});

describe('privacy requests have their own daily bucket (L3)', () => {
  it('30 a day, then 429; feedback is unaffected, and privacy rows do not spend the anonymous or global buckets', async () => {
    const h = setup();
    const ins = h.db.raw.prepare(`INSERT INTO feedback (received_at, t, build, source, category, text, context, updated_at) VALUES (?, ?, '0.0.0', 'privacy', 'privacy', 'Request: access', '{}', ?)`);
    for (let i = 0; i < 30; i++) ins.run(NOW - 1000, NOW - 1000, NOW - 1000);
    const res = await h.post();
    expect(res.status).toBe(429);
    // an ordinary anonymous note still lands: the 30 privacy rows are not in its bucket
    expect((await h.post({ ...META, source: 'menu', category: 'idea', text: 'more tanks', contact: undefined })).status).toBe(201);
    // 90 anonymous ordinary notes + 30 privacy rows would be 120 > 100 if privacy rows spent the anonymous bucket
    const an = setup();
    const insA = an.db.raw.prepare(`INSERT INTO feedback (received_at, t, build, source, category, text, context, player, updated_at) VALUES (?, ?, '0.0.0', ?, ?, 'x', '{}', ?, ?)`);
    for (let i = 0; i < 90; i++) insA.run(NOW - 1000, NOW - 1000, 'menu', 'idea', null, NOW - 1000);
    for (let i = 0; i < 30; i++) insA.run(NOW - 1000, NOW - 1000, 'privacy', 'privacy', null, NOW - 1000);
    expect((await an.post({ ...META, source: 'menu', category: 'idea', text: 'more', contact: undefined }, '203.0.113.20')).status).toBe(201);
    // 480 named ordinary notes + 30 privacy rows would be 510 > 500 if privacy rows spent the global bucket
    const gl = setup();
    const insG = gl.db.raw.prepare(`INSERT INTO feedback (received_at, t, build, source, category, text, context, player, updated_at) VALUES (?, ?, '0.0.0', ?, ?, 'x', '{}', ?, ?)`);
    for (let i = 0; i < 480; i++) insG.run(NOW - 1000, NOW - 1000, 'menu', 'idea', `0f8fad5b-d9cb-469f-a165-70867728${String(i).padStart(4, '0')}`, NOW - 1000);
    for (let i = 0; i < 30; i++) insG.run(NOW - 1000, NOW - 1000, 'privacy', 'privacy', null, NOW - 1000);
    expect((await gl.post({ ...META, source: 'menu', category: 'idea', text: 'more', contact: undefined }, '203.0.113.21')).status).toBe(201);
    // and 500 ordinary notes do not block a privacy request
    const g = setup();
    const ins2 = g.db.raw.prepare(`INSERT INTO feedback (received_at, t, build, source, category, text, context, updated_at) VALUES (?, ?, '0.0.0', 'menu', 'idea', 'x', '{}', ?)`);
    for (let i = 0; i < 500; i++) ins2.run(NOW - 1000, NOW - 1000, NOW - 1000);
    expect((await g.post()).status).toBe(201);
  });
});

describe('the 180-day purge trims a privacy request to its type (L1)', () => {
  it('keeps "Request: deletion" and nothing else; leaves a fresh one and an ordinary note alone', async () => {
    const h = setup();
    const old = NOW - 181 * 86_400_000;
    const ins = h.db.raw.prepare(`INSERT INTO feedback (received_at, t, build, source, category, text, contact, note, context, updated_at) VALUES (?, ?, '0.0.0', ?, ?, ?, 'dana on Discord', 'called her', '{}', ?)`);
    ins.run(old, old, 'privacy', 'privacy', 'Request: deletion\nAccount: Dana #1234\n\nPlease delete me.', old);
    ins.run(old, old, 'privacy', 'privacy', 'my own free text with a name', old);
    ins.run(NOW - 1000, NOW - 1000, 'privacy', 'privacy', 'Request: access\nAccount: Dana', NOW);
    ins.run(old, old, 'menu', 'idea', 'more tanks', old);
    await purgeExpired(h.env, NOW);
    const rows = h.db.raw.prepare('SELECT id, text, contact, note FROM feedback ORDER BY id').all();
    expect(rows).toEqual([
      { id: 1, text: 'Request: deletion', contact: null, note: null },
      { id: 2, text: 'Request', contact: null, note: null },
      { id: 3, text: 'Request: access\nAccount: Dana', contact: 'dana on Discord', note: 'called her' },
      { id: 4, text: 'more tanks', contact: null, note: 'called her' },
    ]);
  });
});

describe('a privacy request is private', () => {
  it('shows on the password-protected /stats feedback API, and nowhere without the cookie', async () => {
    const h = setup();
    await h.post();
    expect((await h.stats('/stats/api/feedback', false)).status).not.toBe(200);
    const list = (await (await h.stats('/stats/api/feedback')).json()) as { rows: { category: string; snippet: string }[]; kinds: string[] };
    expect(list.rows[0]?.category).toBe('privacy');
    expect(list.kinds).toContain('privacy');
    expect((await h.stats('/stats/api/feedback/1', false)).status).not.toBe(200);
  });

  it('never yields a GitHub issue link: the detail has none, and filing it is refused', async () => {
    const h = setup();
    await h.post();
    const d = await feedbackDetail(h.env, 1, ORIGIN);
    expect(d?.issue).toBeNull();
    expect(JSON.stringify(d)).not.toContain('github.com');
    for (const body of [{ action: 'file' }, { action: 'file', issue: 12 }, { action: 'issue', issue: 12 }]) {
      const r = await applyFeedbackAction(h.env, 1, body, NOW);
      expect(r).toMatchObject({ ok: false, code: 409 });
    }
    expect(h.db.raw.prepare('SELECT status, issue FROM feedback').get()).toEqual({ status: 'new', issue: null });
    // the other triage steps still work
    expect(await applyFeedbackAction(h.env, 1, { action: 'triage' }, NOW)).toMatchObject({ ok: true });
  });

  it('a normal note still gets its issue link (the privacy rule did not remove the feature)', async () => {
    const h = setup();
    await h.post({ ...META, source: 'menu', category: 'idea', text: 'more tanks' });
    const d = await feedbackDetail(h.env, 1, ORIGIN);
    expect(d?.issue?.url).toContain('https://github.com/ilan-pinto/roaring-lions/issues/new?');
  });

  it('the triage page hides the GitHub button and the issue preview when there is no link', () => {
    expect(FEEDBACK_HTML).toContain('if(d.issue&&(can(');
    expect(FEEDBACK_HTML).toContain('never turned into a GitHub issue link');
  });

  it('the public form page and /privacy page never embed a request, and carry no token, name or contact in any URL', () => {
    expect(PRIVACY_REQUEST_HTML).not.toContain('github.com/ilan-pinto/roaring-lions/issues');
    expect(PRIVACY_REQUEST_HTML).toContain("'/api/feedback'");
    expect(PRIVACY_REQUEST_HTML).toContain("source: 'privacy', category: 'privacy'");
  });
});

describe('the pages and routes', () => {
  const fetchPath = (p: string, init?: RequestInit) => worker.fetch(new Request(`${ORIGIN}${p}`, init), { DB: openTestD1(), ASSETS: { fetch: async () => new Response('asset') } } as Env);

  it('GET /privacy/request serves the form with the page CSP and security headers; other methods are 405', async () => {
    const res = await fetchPath('/privacy/request');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Send a privacy request');
    expect(res.headers.get('content-security-policy')).toContain("connect-src 'self'");
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect((await fetchPath('/privacy/request', { method: 'POST' })).status).toBe(405);
  });

  it('GET /.well-known/security.txt serves RFC 9116 fields: the private advisory link and a future Expires', async () => {
    const res = await fetchPath('/.well-known/security.txt');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/plain/);
    const body = await res.text();
    expect(body).toContain('Contact: https://github.com/ilan-pinto/roaring-lions/security/advisories/new');
    const expires = /^Expires: (.+)$/m.exec(body)?.[1] ?? '';
    // Goes red 30 days BEFORE it lapses (a real clock, on purpose): renew Expires in security-txt.ts.
    expect(Date.parse(expires), 'security.txt Expires is within 30 days: renew it').toBeGreaterThan(Date.now() + 30 * 86_400_000);
    expect(Date.parse(expires)).toBeLessThan(Date.parse('2027-11-16'));
  });

  it('wrangler sends both new paths to the Worker', () => {
    const raw = readFileSync(fileURLToPath(new URL('../../../wrangler.jsonc', import.meta.url)), 'utf8');
    for (const p of ['"/privacy/request"', '"/.well-known/security.txt"']) expect(raw).toContain(p);
  });

  it('SECURITY.md points at the private advisory form', () => {
    const md = readFileSync(fileURLToPath(new URL('../../../SECURITY.md', import.meta.url)), 'utf8');
    expect(md).toContain('https://github.com/ilan-pinto/roaring-lions/security/advisories/new');
  });

  it('the privacy page links the form, drops the GitHub-issue sentence, and stays fail-closed', () => {
    const html = renderPrivacy(privacyValues(PRIVACY_CONTACT, PRIVACY_MIN_AGE) ?? { contact: 'x', minAge: 16 });
    expect(html).toContain('<a href="/privacy/request">');
    expect(html).not.toContain('open an issue titled');
    expect(html).toContain('After 180 days it is cut down to the type of request');
    expect(privacyValues('', 16)).toBeNull();
    expect(privacyValues('TBD', 16)).toBeNull();
    expect(privacyValues(PRIVACY_CONTACT, null)).toBeNull();
  });
});

describe('migration 0007', () => {
  it('widens the CHECKs and keeps every row, index and attachment of an existing database', () => {
    const dir = fileURLToPath(new URL('../migrations/', import.meta.url));
    const files = ['0001_init.sql', '0003_feedback.sql'];
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    for (const f of files) db.exec(readFileSync(dir + f, 'utf8'));
    db.exec(`INSERT INTO feedback (received_at, t, build, source, category, text, context, shot_bytes, updated_at) VALUES (1, 1, '0.1.0', 'pause', 'bug', 'old', '{}', 3, 1)`);
    db.prepare('INSERT INTO feedback_picture (feedback_id, bytes) VALUES (1, ?)').run(new Uint8Array([1, 2, 3]));
    db.exec(`INSERT INTO feedback_replay (feedback_id, json) VALUES (1, '{"a":1}')`);
    expect(() => db.exec(`INSERT INTO feedback (received_at, t, build, source, category, text, context, updated_at) VALUES (2, 2, '0.0.0', 'privacy', 'privacy', 'x', '{}', 2)`)).toThrow();
    db.exec(readFileSync(dir + '0007_feedback_privacy.sql', 'utf8'));
    // L2: widened once for the chat-safety design's future report / match, so no second rebuild
    db.exec(`INSERT INTO feedback (received_at, t, build, source, category, text, context, updated_at) VALUES (3, 3, '0.0.0', 'match', 'report', 'r', '{}', 3)`);
    db.exec("DELETE FROM feedback WHERE text = 'r'");
    expect(() => db.exec(`INSERT INTO feedback (received_at, t, build, source, category, text, context, updated_at) VALUES (4, 4, '0.0.0', 'chat', 'rant', 'r', '{}', 4)`)).toThrow();
    db.exec(`INSERT INTO feedback (received_at, t, build, source, category, text, context, updated_at) VALUES (2, 2, '0.0.0', 'privacy', 'privacy', 'x', '{}', 2)`);
    expect(db.prepare('SELECT id, text, shot_bytes FROM feedback ORDER BY id').all()).toEqual([{ id: 1, text: 'old', shot_bytes: 3 }, { id: 2, text: 'x', shot_bytes: null }]);
    expect(db.prepare('SELECT feedback_id, bytes FROM feedback_picture').all()).toEqual([{ feedback_id: 1, bytes: new Uint8Array([1, 2, 3]) }]);
    expect(db.prepare('SELECT feedback_id, json FROM feedback_replay').all()).toEqual([{ feedback_id: 1, json: '{"a":1}' }]);
    expect(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='index' AND name LIKE 'feedback_%'").get()).toEqual({ n: 6 });
    db.exec('DELETE FROM feedback WHERE id = 1'); // the cascade is back
    expect(db.prepare('SELECT COUNT(*) AS n FROM feedback_picture').get()).toEqual({ n: 0 });
  });
});
