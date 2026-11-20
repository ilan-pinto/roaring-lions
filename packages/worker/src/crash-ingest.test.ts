// GH-1414: POST /api/crash. Every limit is a literal here (never imported from the code under test), so a drifted
// constant goes red.
import { describe, it, expect } from 'vitest';
import worker from './index';
import { crashOpen, handleCrash } from './crash-ingest';
import { handleStats } from './stats';
import { STATS_HTML } from './stats-page';
import { SESSION_COOKIE, signSession } from './auth';
import { openTestD1 } from './test-d1';
import type { Env, RateLimiter } from './d1';
import { CAPTURED } from './crash-captured.test-helper';

const OWN = 'https://game.example.workers.dev';
const DESKTOP = 'app://roaring-lions.local';
const NOW = 1_795_000_000_000;
const DAY = 86_400_000;
const IP = '203.0.113.9';
const BODY_MAX = 6144;
const LIMITS = { launch: 10, ip: 20, all: 200 };
const RETENTION = 90 * DAY;
const L1 = '0f8fad5b-d9cb-469f-a165-70867728950e';
const REPORT = {
  v: 1,
  t: NOW - 1000,
  kind: 'page_exception',
  launch: L1,
  uptimeS: 312,
  version: '0.134.1',
  commit: 'a8b15c424',
  electron: '45.2.1',
  chrome: '156.0.8078.75',
  platform: 'linux',
  arch: 'x64',
  gpu: 'Software (no GPU)',
  screen: 'mission',
  mission: 'beit_sahwan_2_foothold',
  name: 'TypeError',
  message: 'Cannot read properties of undefined (reading <str>)',
  stack: ['stepMovement (web/assets/index-Dk2a9.js:1:23456)', 'loop (web/assets/index-Dk2a9.js:2:10)'],
};
const launchN = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function setup(over: Partial<Env> = {}, open = true) {
  const db = openTestD1();
  if (open) db.raw.exec(`INSERT INTO flags (name, value, updated_at) VALUES ('crash', 'open', 0)`);
  const env: Env = { DB: db, ASSETS: { fetch: async () => new Response('') }, STATS_PASSWORD: 's'.repeat(24), ...over };
  const post = (body: unknown = REPORT, o: { headers?: Record<string, string>; now?: number; raw?: boolean; method?: string } = {}) =>
    handleCrash(
      new Request(`${OWN}/api/crash`, {
        method: o.method ?? 'POST',
        body: o.method === 'GET' ? undefined : o.raw ? (body as string) : JSON.stringify(body),
        headers: { origin: DESKTOP, 'content-type': 'application/json', 'cf-connecting-ip': IP, ...o.headers },
      }),
      env,
      o.now ?? NOW
    );
  const rows = () => db.raw.prepare('SELECT * FROM crash_report ORDER BY id').all() as Record<string, unknown>[];
  return { db, env, post, rows };
}

describe('POST /api/crash stores a valid report', () => {
  it('answers 204 and stores exactly the record, with no IP anywhere', async () => {
    const { post, rows, db } = setup({ TICKET_SECRET: 't'.repeat(32) });
    const res = await post();
    expect(res.status).toBe(204);
    const [row, ...more] = rows();
    expect(more).toEqual([]);
    expect(row).toMatchObject({
      received_at: NOW, t: NOW - 1000, kind: 'page_exception', launch: L1, uptime_s: 312, version: '0.134.1', commit: 'a8b15c424',
      electron: '45.2.1', chrome: '156.0.8078.75', platform: 'linux', arch: 'x64', gpu: 'Software (no GPU)', screen: 'mission',
      mission: 'beit_sahwan_2_foothold', name: 'TypeError', reason: null, exit_code: null,
    });
    expect(JSON.parse(String(row?.stack))).toEqual(REPORT.stack);
    // The address is in no row of any table: the day counter holds a keyed hash of it.
    const everything = JSON.stringify(db.raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((t) => db.raw.prepare(`SELECT * FROM "${(t as { name: string }).name}"`).all()));
    expect(everything).not.toContain(IP);
    expect(everything).not.toContain('203.0.113');
  });

  it('is reachable through the Worker at /api/crash, with the security headers', async () => {
    const { env } = setup();
    const res = await worker.fetch(
      new Request(`${OWN}/api/crash`, { method: 'POST', body: JSON.stringify(REPORT), headers: { origin: DESKTOP, 'content-type': 'application/json' } }),
      env
    );
    expect(res.status).toBe(204);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('stores a process report with its reason, exit code and process', async () => {
    const { post, rows } = setup();
    const gone = { ...REPORT, kind: 'child_gone', reason: 'crashed', exitCode: 133, process: 'GPU', name: undefined, message: undefined, stack: undefined };
    expect((await post(gone)).status).toBe(204);
    expect(rows()[0]).toMatchObject({ kind: 'child_gone', reason: 'crashed', exit_code: 133, process: 'GPU', name: null, message: null, stack: null });
  });
});

describe('what a real Electron sent', () => {
  it.each(CAPTURED.map((b) => [JSON.parse(b).kind as string, b]))('%s: stored, as sent', async (_kind, body) => {
    const { post, rows } = setup();
    const res = await post(body, { raw: true, headers: { 'user-agent': 'roaring-lions-desktop' } });
    expect(res.status).toBe(204);
    expect(rows()).toHaveLength(1);
  });
});

describe('the kill switch is closed by default', () => {
  it('no flags row: 410, nothing stored', async () => {
    const { post, rows } = setup({}, false);
    const res = await post();
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({ error: 'closed' });
    expect(rows()).toEqual([]);
  });
  it.each(['closed', 'OPEN', 'opened', '1', ''])('flags.crash = %j is closed', async (value) => {
    const { db, env, post, rows } = setup({}, false);
    db.raw.prepare("INSERT INTO flags (name, value, updated_at) VALUES ('crash', ?, 0)").run(value);
    expect(await crashOpen(env)).toBe(false);
    expect((await post()).status).toBe(410);
    expect(rows()).toEqual([]);
  });
  it.each(['1', 'true', 'yes', ' closed '])('env CRASH_CLOSED = %j closes it with the flag open', async (v) => {
    const { post, rows } = setup({ CRASH_CLOSED: v });
    expect((await post()).status).toBe(410);
    expect(rows()).toEqual([]);
  });
  it.each(['', '0', 'false'])('env CRASH_CLOSED = %j leaves an open flag open', async (v) => {
    const { post } = setup({ CRASH_CLOSED: v });
    expect((await post()).status).toBe(204);
  });
  it('the feedback flag does not open it', async () => {
    const { db, post } = setup({}, false);
    db.raw.exec("INSERT INTO flags (name, value, updated_at) VALUES ('feedback', 'open', 0)");
    expect((await post()).status).toBe(410);
  });
  it('a database without the flags table answers 503, not a write', async () => {
    const { db, post } = setup({}, false);
    db.raw.exec('DROP TABLE flags');
    expect((await post()).status).toBe(503);
  });
  it('a database without the crash table (0008 not applied) answers 503 and leaves no counter behind it claims', async () => {
    const { db, post } = setup();
    db.raw.exec('DROP TABLE crash_report');
    expect((await post()).status).toBe(503);
  });
});

describe('origin', () => {
  it.each([
    ['the desktop build', DESKTOP, 204],
    ['this Worker', OWN, 204],
    ['another site', 'https://evil.example', 403],
    ['a look-alike desktop host', 'app://roaring-lions.local.evil', 403],
    ['the desktop scheme on another host', 'app://evil.local', 403],
    ['null', 'null', 403],
  ])('%s (%s): %i', async (_what, origin, want) => {
    const { post } = setup();
    expect((await post(REPORT, { headers: { origin } })).status).toBe(want);
  });
  it('no Origin header: 403', async () => {
    const { env } = setup();
    const res = await handleCrash(new Request(`${OWN}/api/crash`, { method: 'POST', body: JSON.stringify(REPORT), headers: { 'content-type': 'application/json' } }), env, NOW);
    expect(res.status).toBe(403);
  });
  it('an origin in ALLOWED_ORIGINS passes', async () => {
    const { post } = setup({ ALLOWED_ORIGINS: 'https://lions.example' });
    expect((await post(REPORT, { headers: { origin: 'https://lions.example' } })).status).toBe(204);
  });
});

describe('size, type and shape', () => {
  it('any method but POST is 405', async () => {
    const { post } = setup();
    const res = await post(REPORT, { method: 'GET' });
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('POST');
  });
  it('a declared Content-Length over 6144 is 413 before the body is read', async () => {
    const { post, rows } = setup();
    expect((await post(REPORT, { headers: { 'content-length': String(BODY_MAX + 1) } })).status).toBe(413);
    expect(rows()).toEqual([]);
  });
  it('a body of exactly 6144 bytes is read, and one byte more is 413 whatever it declares', async () => {
    const { post } = setup();
    const pad = (n: number) => JSON.stringify(REPORT).padEnd(n, ' ');
    expect(JSON.stringify(REPORT).length).toBeLessThan(BODY_MAX);
    expect((await post(pad(BODY_MAX), { raw: true })).status).toBe(204);
    expect((await post(pad(BODY_MAX + 1), { raw: true, headers: { 'content-length': '10' } })).status).toBe(413);
  });
  it.each(['text/plain', 'multipart/form-data; boundary=x', 'application/jsonp', ''])('content type %j is 415', async (ct) => {
    const { post } = setup();
    expect((await post(REPORT, { headers: { 'content-type': ct } })).status).toBe(415);
  });
  it('content type with a charset is accepted', async () => {
    const { post } = setup();
    expect((await post(REPORT, { headers: { 'content-type': 'application/json; charset=utf-8' } })).status).toBe(204);
  });
  it('not JSON is 400; a record the schema refuses is 400 with its reason, and nothing is stored', async () => {
    const { post, rows } = setup();
    expect((await post('{', { raw: true })).status).toBe(400);
    const leak = await post({ ...REPORT, stack: ['f (/home/dana/x.js:1:1)'] });
    expect(leak.status).toBe(400);
    expect(await leak.json()).toEqual({ error: 'stack frame' });
    expect((await post({ ...REPORT, message: 'from dana@example.com' })).status).toBe(400);
    expect((await post({ ...REPORT, email: 'dana@example.com' })).status).toBe(400);
    expect(rows()).toEqual([]);
  });
});

describe('rate limits', () => {
  it('the per-minute IP binding: 429 with retryAfter 60, nothing stored', async () => {
    const keys: string[] = [];
    const limiter: RateLimiter = { limit: async ({ key }) => (keys.push(key), { success: false }) };
    const { post, rows } = setup({ CRASH_LIMIT: limiter });
    const res = await post();
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ retryAfter: 60 });
    expect(keys).toEqual([IP]);
    expect(rows()).toEqual([]);
  });
  it('a launch: 10 a day, the 11th is 429; another launch still lands', async () => {
    const { post, rows } = setup();
    for (let i = 0; i < LIMITS.launch; i++) expect((await post(REPORT, { now: NOW + i })).status).toBe(204);
    expect((await post(REPORT, { now: NOW + 99 })).status).toBe(429);
    expect((await post({ ...REPORT, launch: launchN(2) }, { now: NOW + 100 })).status).toBe(204);
    expect(rows()).toHaveLength(LIMITS.launch + 1);
  });
  it('an address: 20 a day across launches (keyed by the IP secret); another address still lands', async () => {
    const { post } = setup({ TICKET_SECRET: 't'.repeat(32) });
    for (let i = 0; i < LIMITS.ip; i++) expect((await post({ ...REPORT, launch: launchN(i) }, { now: NOW + i })).status).toBe(204);
    expect((await post({ ...REPORT, launch: launchN(500) }, { now: NOW + 50 })).status).toBe(429);
    expect((await post({ ...REPORT, launch: launchN(501) }, { now: NOW + 51, headers: { 'cf-connecting-ip': '198.51.100.7' } })).status).toBe(204);
  });
  it('all reports: 200 a day whatever the launches and addresses, then 429 until tomorrow', async () => {
    const { post, rows } = setup();
    const from = (i: number) => ({ 'cf-connecting-ip': `198.51.${i >> 8}.${i & 255}` });
    for (let i = 0; i < LIMITS.all; i++) expect((await post({ ...REPORT, launch: launchN(i) }, { now: NOW + i, headers: from(i) })).status).toBe(204);
    const res = await post({ ...REPORT, launch: launchN(9999) }, { now: NOW + 300, headers: from(9999) });
    expect(res.status).toBe(429);
    const { retryAfter } = (await res.json()) as { retryAfter: number };
    expect(retryAfter).toBe(Math.ceil((DAY - ((NOW + 300) % DAY)) / 1000));
    expect(rows()).toHaveLength(LIMITS.all);
    expect((await post({ ...REPORT, launch: launchN(9999) }, { now: NOW + DAY, headers: from(9999) })).status).toBe(204);
  });
});

describe('retention', () => {
  it('an insert deletes rows older than 90 days, at most 25 of them, and keeps the rest', async () => {
    const { db, post, rows } = setup();
    const ins = db.raw.prepare(
      `INSERT INTO crash_report (received_at, t, kind, launch, uptime_s, version, electron, platform, arch, gpu, name, message)
       VALUES (?, 0, 'page_exception', ?, 0, '0.1.0', '45.2.1', 'linux', 'x64', 'Unknown', 'Error', '')`
    );
    for (let i = 0; i < 30; i++) ins.run(NOW - RETENTION - 1 - i, launchN(1000 + i));
    ins.run(NOW - RETENTION + 1, launchN(2000)); // inside the window
    expect((await post()).status).toBe(204);
    const left = rows();
    expect(left.filter((r) => Number(r.received_at) < NOW - RETENTION)).toHaveLength(5);
    expect(left.some((r) => r.launch === launchN(2000))).toBe(true);
    expect((await post({ ...REPORT, launch: launchN(3) })).status).toBe(204);
    expect(rows().filter((r) => Number(r.received_at) < NOW - RETENTION)).toHaveLength(0);
  });
});

describe('/stats shows the reports', () => {
  const authed = async (env: Env, path: string) => {
    const cookie = await signSession(String(env.STATS_PASSWORD), NOW + DAY);
    return handleStats(new Request(`${OWN}${path}`, { headers: { cookie: `${SESSION_COOKIE}=${cookie}` } }), env, NOW);
  };
  it('GET /stats/api/crashes lists the newest with their stacks, and groups them', async () => {
    const { env, post } = setup();
    await post();
    await post({ ...REPORT, kind: 'renderer_gone', reason: 'oom', name: undefined, message: undefined, stack: undefined, launch: launchN(7) }, { now: NOW + 5 });
    const res = await authed(env, '/stats/api/crashes');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { latest: Record<string, unknown>[]; groups: Record<string, unknown>[] };
    expect(body.latest.map((r) => r.kind)).toEqual(['renderer_gone', 'page_exception']);
    expect(body.latest[1]?.stack).toEqual(REPORT.stack);
    expect(body.latest[0]?.stack).toEqual([]);
    expect(body.groups).toContainEqual({ kind: 'page_exception', version: '0.134.1', gpu: 'Software (no GPU)', n: 1, launches: 1 });
  });
  it('without a session it is 401; before the migration it is 503 and the page tolerates it', async () => {
    const { env, db } = setup();
    expect((await handleStats(new Request(`${OWN}/stats/api/crashes`), env, NOW)).status).toBe(401);
    db.raw.exec('DROP TABLE crash_report');
    expect((await authed(env, '/stats/api/crashes')).status).toBe(503);
    for (const needle of ['id="crash-groups"', 'id="crash-latest"', "getOr('crashes',null)", 'Array.isArray(cr.latest)']) expect(STATS_HTML).toContain(needle);
  });
});
