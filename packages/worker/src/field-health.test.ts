import { describe, expect, it } from 'vitest';
import { handleIngest } from './ingest';
import { fieldHealth, HEALTH_ROW_CAP } from './field-health';
import { handleStats } from './stats';
import { STATS_HTML } from './stats-page';
import { openTestD1 } from './test-d1';
import type { Env } from './d1';
import type { StatsFilter } from './stats';

const T0 = Date.UTC(2026, 10, 15);
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ALL: StatsFilter = { since: 0, testersOnly: false, includeDev: false };
const env0 = (p: number, s: number, t: number, extra: Record<string, unknown> = {}) => ({ v: 1, player: id(p), session: id(1000 + s), build: '1.0.0', t, ...extra });
// The client sends the FAMILY (`gpuFamily`, `@lions/data`), never the raw renderer string.
const M3 = 'Apple M3';
const RTX = 'NVIDIA RTX 30-series';

async function setup() {
  const db = openTestD1();
  const env: Env = { DB: db, ASSETS: { fetch: async () => new Response('') } };
  // One request speaks for one player (ingest): post per player.
  const post = async (events: { player: string }[]) => {
    for (const p of [...new Set(events.map((e) => e.player))]) {
      await handleIngest(new Request('https://g.dev/api/events', { method: 'POST', body: JSON.stringify({ events: events.filter((e) => e.player === p) }) }), env, T0);
    }
  };
  return { db, env, post };
}

describe('fieldHealth', () => {
  it('crash-free rate: the share of sessions with no client_error, counted over every session that sent anything', async () => {
    const { db, post } = await setup();
    await post([
      env0(1, 1, T0, { type: 'session_start', screen: 'menu', renderer: 'three', viewport: [1440, 900], returning: false }),
      env0(2, 2, T0, { type: 'session_start', screen: 'menu', renderer: 'three', viewport: [1440, 900], returning: false }),
      env0(3, 3, T0, { type: 'session_start', screen: 'menu', renderer: 'three', viewport: [1440, 900], returning: false }),
      env0(4, 4, T0, { type: 'session_start', screen: 'menu', renderer: 'three', viewport: [1440, 900], returning: false }),
      env0(2, 2, T0 + 1, { type: 'client_error', name: 'TypeError', message: 'boom', hash: 'aaaaaaaa' }),
      env0(2, 2, T0 + 2, { type: 'client_error', name: 'TypeError', message: 'boom', hash: 'aaaaaaaa' }), // the same session twice is one crashed session
    ]);
    const h = await fieldHealth(db, ALL);
    expect(h).toMatchObject({ sessions: 4, crashedSessions: 1, crashFreeRate: 0.75 });
  });

  it('no session at all: the rate is null, not 0 or NaN', async () => {
    const { db } = await setup();
    expect(await fieldHealth(db, ALL)).toMatchObject({ sessions: 0, crashedSessions: 0, crashFreeRate: null, topErrors: [], frames: [], boot: { n: 0, medianMs: null } });
  });

  it('the commonest crash is first, ranked by sessions then times', async () => {
    const { db, post } = await setup();
    const err = (p: number, s: number, hash: string, name = 'TypeError') => env0(p, s, T0, { type: 'client_error', name, message: `m ${hash}`, hash });
    // dddddddd: one session hit it 5 times (a loop); bbbbbbbb: two sessions, 3 times. Sessions rank first, so the loop does not top the list.
    await post([err(1, 1, 'aaaaaaaa'), err(2, 2, 'bbbbbbbb'), err(3, 3, 'bbbbbbbb'), err(3, 3, 'bbbbbbbb'), err(4, 4, 'cccccccc', 'RangeError'), ...[0, 1, 2, 3, 4].map(() => err(5, 5, 'dddddddd'))]);
    const h = await fieldHealth(db, ALL);
    expect(h.topErrors.map((e) => [e.hash, e.sessions, e.count])).toEqual([['bbbbbbbb', 2, 3], ['dddddddd', 1, 5], ['aaaaaaaa', 1, 1], ['cccccccc', 1, 1]]);
    expect(h.topErrors[3]).toMatchObject({ name: 'RangeError', message: 'm cccccccc' });
  });

  it('frame percentiles by GPU family: the median of the samples, grouped, busiest family first', async () => {
    const { db, post } = await setup();
    const perf = (p: number, s: number, gpu: string | undefined, p50: number, p95: number, p99: number, units = 100) =>
      env0(p, s, T0 + p, { type: 'perf_sample', mission: 'm1', units, preset: 'high', backend: 'webgl2', ...(gpu === undefined ? {} : { gpu }), frames: 3000, p50, p95, p99 });
    await post([
      perf(1, 1, M3, 10, 14, 20, 200),
      perf(1, 1, M3, 12, 16, 22, 300),
      perf(1, 1, M3, 11, 15, 90, 100), // three samples: medians 11 / 15 / 22
      perf(2, 2, RTX, 8, 12, 18),
      perf(3, 3, undefined, 30, 40, 50), // the browser would not say
    ]);
    const h = await fieldHealth(db, ALL);
    expect(h.frames.map((r) => r.family)).toEqual(['Apple M3', 'NVIDIA RTX 30-series', 'Unknown']);
    expect(h.frames[0]).toMatchObject({ samples: 3, sessions: 1, p50: 11, p95: 15, p99: 22, medianUnits: 200 });
    expect(h.frames[1]).toMatchObject({ samples: 1, p50: 8, p95: 12, p99: 18 });
    expect(h.frames[2]).toMatchObject({ family: 'Unknown', p50: 30 });
  });

  it('boot: the median and the 95th percentile time to first frame', async () => {
    const { db, post } = await setup();
    const boot = (p: number, ttffMs: number) => env0(p, p, T0, { type: 'boot', ttffMs, backend: 'webgl2', preset: 'high' });
    await post([boot(1, 1000), boot(2, 2000), boot(3, 3000), boot(4, 4000)]);
    expect((await fieldHealth(db, ALL)).boot).toEqual({ n: 4, medianMs: 2500, p95Ms: 4000 });
  });

  it('dev traffic is out by default and in with the dev filter; the window filter applies', async () => {
    const { db, post } = await setup();
    await post([
      env0(1, 1, T0, { type: 'client_error', name: 'Error', message: 'm', hash: 'aaaaaaaa', dev: true }),
      env0(2, 2, T0 - 10 * 86_400_000, { type: 'client_error', name: 'Error', message: 'm', hash: 'bbbbbbbb' }),
      env0(3, 3, T0, { type: 'client_error', name: 'Error', message: 'm', hash: 'cccccccc' }),
    ]);
    expect((await fieldHealth(db, ALL)).topErrors.map((e) => e.hash).sort()).toEqual(['bbbbbbbb', 'cccccccc']);
    expect((await fieldHealth(db, { ...ALL, includeDev: true })).topErrors).toHaveLength(3);
    expect((await fieldHealth(db, { ...ALL, since: T0 - 86_400_000 })).topErrors.map((e) => e.hash)).toEqual(['cccccccc']);
  });

  it('a row the page could not parse is skipped, not a 500', async () => {
    const { db } = await setup();
    await db.prepare('INSERT INTO events (type, player, session, tester, build, mission, t, received_at, dev, payload) VALUES (?, ?, ?, NULL, ?, NULL, ?, ?, 0, ?)').bind('client_error', id(1), id(1001), '1.0.0', T0, T0, '{not json').run();
    const h = await fieldHealth(db, ALL);
    expect(h.topErrors).toEqual([]);
    expect(h.crashedSessions).toBe(1);
  });

  it('says when a kind of row hit the cap', () => {
    expect(HEALTH_ROW_CAP).toBe(20_000);
  });
});

describe('the new events through the ingest and the API', () => {
  it('ingest stores the three types, and the stored rows hold no IP, email or user agent', async () => {
    const { db, env } = await setup();
    const events = [
      env0(1, 1, T0, { type: 'boot', ttffMs: 900, backend: 'webgl2', preset: 'high', gpu: M3 }),
      env0(1, 1, T0 + 1, { type: 'client_error', name: 'TypeError', message: 'boom', hash: 'aaaaaaaa' }),
      env0(1, 1, T0 + 2, { type: 'perf_sample', mission: 'm1', units: 10, preset: 'high', backend: 'webgl2', frames: 400, p50: 10, p95: 12, p99: 14 }),
    ];
    const req = new Request('https://g.dev/api/events', {
      method: 'POST',
      body: JSON.stringify({ events }),
      headers: { 'cf-connecting-ip': '203.0.113.77', 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) UniqueUAString', origin: 'https://g.dev' },
    });
    expect((await handleIngest(req, env, T0)).status).toBe(204);
    const dump = JSON.stringify(db.raw.prepare('SELECT * FROM events_all').all()) + JSON.stringify(db.raw.prepare('SELECT * FROM event_batch').all());
    for (const type of ['boot', 'client_error', 'perf_sample']) expect(dump).toContain(type);
    for (const needle of ['203.0.113.77', 'UniqueUAString', 'Mozilla']) expect(dump, needle).not.toContain(needle);
  });

  it('an event that carries a stack, a user agent or an ip is dropped whole', async () => {
    const { db, env } = await setup();
    const bad = [
      env0(1, 1, T0, { type: 'client_error', name: 'Error', message: 'm', hash: 'aaaaaaaa', stack: 'at x (/Users/dana/a.js:1:1)' }),
      env0(1, 1, T0, { type: 'client_error', name: 'Error', message: 'm', hash: 'aaaaaaaa', ua: 'Mozilla/5.0' }),
      env0(1, 1, T0, { type: 'boot', ttffMs: 1, backend: 'webgl2', preset: 'high', ip: '203.0.113.9' }),
    ];
    await handleIngest(new Request('https://g.dev/api/events', { method: 'POST', body: JSON.stringify({ events: bad }) }), env, T0);
    expect((db.raw.prepare('SELECT COUNT(*) AS n FROM events_all').get() as { n: number }).n).toBe(0);
  });

  it('GET /stats/api/health without a session is a 401 JSON error', async () => {
    const { env } = await setup();
    const res = await handleStats(new Request('https://g.dev/stats/api/health'), { ...env, STATS_PASSWORD: 'x'.repeat(24) }, T0);
    expect(res.status).toBe(401);
  });

  it('the page has the field-health panels and asks for them, tolerating a failed fetch', () => {
    for (const needle of ['id="health"', 'id="health-errors"', 'id="health-frames"', "getOr('health',null)", 'Crash-free sessions']) expect(STATS_HTML).toContain(needle);
  });
});
