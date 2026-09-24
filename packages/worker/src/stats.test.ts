import { describe, it, expect } from 'vitest';
import { openTestD1 } from './test-d1';
import { handleIngest } from './ingest';
import * as stats from './stats';
import type { Env } from './d1';
import { issueValidAccessToken, testAccessEnv } from './access.test-helper';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 8, 20);
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const base = (p: number, t: number, extra: Record<string, unknown> = {}) => ({ v: 1, player: id(p), session: id(100 + p), build: '0.78.0', t, ...extra });

async function seeded() {
  const db = openTestD1();
  const env: Env = { DB: db, ASSETS: { fetch: async () => new Response('') } };
  const send = (events: unknown[]) =>
    handleIngest(new Request('https://g.dev/api/events', { method: 'POST', body: JSON.stringify({ events }) }), env, T0);
  const end = (p: number, t: number, mission: string, result: string, tick: number, cause?: string) =>
    base(p, t, { type: 'mission_end', mission, result, tick, roe: 80, fielded: 5, lost: 1, objectivesDone: 1, objectivesTotal: 2, ...(cause ? { cause } : {}) });
  // Player 1 (tester dani): tutorial, wins breach on day 1, returns on day 2.
  await send([
    base(1, T0, { tester: 'dani', type: 'mission_start', mission: 'beit_sahwan_0_tutorial', replay: false }),
    base(1, T0 + 1, { tester: 'dani', type: 'tutorial_step', step: 0, steps: 14, prevMs: 0 }),
    base(1, T0 + 2, { tester: 'dani', type: 'tutorial_step', step: 1, steps: 14, prevMs: 4000 }),
    base(1, T0 + 3, { tester: 'dani', type: 'mission_start', mission: 'beit_sahwan_breach', replay: false }),
    base(1, T0 + 4, { tester: 'dani', type: 'heartbeat', mission: 'beit_sahwan_breach', tick: 1200 }),
    end(1, T0 + 5, 'beit_sahwan_breach', 'victory', 6000),
    base(1, T0 + 6, { tester: 'dani', type: 'campaign_progress', mission: 'beit_sahwan_breach', missionsWon: 1 }),
    base(1, T0 + DAY, { tester: 'dani', type: 'heartbeat', mission: 'beit_sahwan_1_recon', tick: 1200 }),
  ]);
  // Player 2: tutorial step 0 only, then loses breach to a failed objective.
  await send([
    base(2, T0, { type: 'tutorial_step', step: 0, steps: 14, prevMs: 0 }),
    base(2, T0 + 1, { type: 'mission_start', mission: 'beit_sahwan_breach', replay: false }),
    end(2, T0 + 2, 'beit_sahwan_breach', 'defeat', 3000, 'objective:evac_settlements'),
  ]);
  // Player 3: sandbox only (dev traffic).
  await send([base(3, T0, { type: 'session_start', screen: 'sandbox', renderer: 'three', viewport: [800, 600], returning: false, dev: true })]);
  return db;
}

const all: stats.StatsFilter = { since: 0, testersOnly: false, includeDev: false };

describe('stats queries', () => {
  it('summary counts real players, excludes dev, measures time and day-2 return', async () => {
    const s = await stats.summary(await seeded(), all);
    expect(s).toMatchObject({ players: 2, sessions: 2, hoursPlayed: 2 / 60, returnedDay2: 1, returnRate: 0.5 });
  });

  it('funnel follows campaign order with started and won per mission', async () => {
    const f = await stats.funnel(await seeded(), all);
    expect(f[0]).toMatchObject({ mission: 'beit_sahwan_0_tutorial', started: 1 });
    expect(f.find((r) => r.mission === 'beit_sahwan_breach')).toMatchObject({ started: 2, won: 1 });
  });

  it('tutorial funnel counts players reaching each step', async () => {
    const t = await stats.tutorialFunnel(await seeded(), all);
    expect(t.slice(0, 2)).toEqual([{ step: 0, players: 2 }, { step: 1, players: 1 }]);
  });

  it('per-mission table reports win rate, median real minutes against target, and top loss cause', async () => {
    const m = await stats.missions(await seeded(), all);
    const breach = m.find((r) => r.mission === 'beit_sahwan_breach');
    expect(breach).toMatchObject({ attempts: 2, wins: 1, medianWinMinutes: 5, topCause: 'objective:evac_settlements' });
    expect(breach?.targetMinutes).toBeGreaterThan(0);
  });

  it('filters to one tester', async () => {
    const s = await stats.summary(await seeded(), { ...all, tester: 'dani' });
    expect(s.players).toBe(1);
  });

  it('lists testers with their furthest progress', async () => {
    expect(await stats.testers(await seeded(), all)).toEqual([expect.objectContaining({ tester: 'dani', furthestWon: 'beit_sahwan_breach' })]);
  });

  it('F4: a tester still appears after a dev (free-play) batch', async () => {
    const db = openTestD1();
    const env: Env = { DB: db, ASSETS: { fetch: async () => new Response('') } };
    const send = (events: unknown[]) =>
      handleIngest(new Request('https://g.dev/api/events', { method: 'POST', body: JSON.stringify({ events }) }), env, T0);
    await send([base(9, T0, { tester: 'nir', type: 'session_start', screen: 'sandbox', renderer: 'three', viewport: [800, 600], returning: false, dev: true })]);
    const rows = await stats.testers(db, all);
    expect(rows).toEqual([expect.objectContaining({ tester: 'nir' })]);
  });

  it('F5: a tester who wins a later mission then replays an earlier one still shows the later one', async () => {
    const db = openTestD1();
    const env: Env = { DB: db, ASSETS: { fetch: async () => new Response('') } };
    const send = (events: unknown[]) =>
      handleIngest(new Request('https://g.dev/api/events', { method: 'POST', body: JSON.stringify({ events }) }), env, T0);
    await send([
      base(10, T0, { tester: 'orit', type: 'campaign_progress', mission: 'beit_sahwan_2_foothold', missionsWon: 2 }),
      base(10, T0 + 1, { tester: 'orit', type: 'campaign_progress', mission: 'beit_sahwan_1_recon', missionsWon: 2 }),
    ]);
    const rows = await stats.testers(db, all);
    expect(rows).toEqual([expect.objectContaining({ tester: 'orit', furthestWon: 'beit_sahwan_2_foothold' })]);
  });
});

describe('handleStats', () => {
  const DOMAIN = 'stats-test.cloudflareaccess.com';

  it('refuses without the Access assertion header', async () => {
    const env: Env = { DB: openTestD1(), ASSETS: { fetch: async () => new Response('') }, ...testAccessEnv(DOMAIN) };
    const res = await stats.handleStats(new Request('https://g.dev/stats'), env, T0);
    expect(res.status).toBe(403);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
  it('refuses a forged header value that is not a valid Access JWT', async () => {
    const env: Env = { DB: openTestD1(), ASSETS: { fetch: async () => new Response('') }, ...testAccessEnv(DOMAIN) };
    const h = { 'cf-access-jwt-assertion': 'x' };
    const res = await stats.handleStats(new Request('https://g.dev/stats', { headers: h }), env, T0);
    expect(res.status).toBe(403);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
  it('serves the page and JSON with a validly signed Access token', async () => {
    const env: Env = { DB: await seeded(), ASSETS: { fetch: async () => new Response('') }, ...testAccessEnv(DOMAIN) };
    const h = { 'cf-access-jwt-assertion': await issueValidAccessToken(DOMAIN, T0) };
    expect((await stats.handleStats(new Request('https://g.dev/stats', { headers: h }), env, T0)).headers.get('content-type')).toContain('text/html');
    const res = await stats.handleStats(new Request('https://g.dev/stats/api/summary?range=all', { headers: h }), env, T0);
    expect(await res.json()).toMatchObject({ players: 2 });
  });
  it('answers an unknown /stats/api path with an uncached 404', async () => {
    const env: Env = { DB: await seeded(), ASSETS: { fetch: async () => new Response('') }, ...testAccessEnv(DOMAIN) };
    const h = { 'cf-access-jwt-assertion': await issueValidAccessToken(DOMAIN, T0) };
    const res = await stats.handleStats(new Request('https://g.dev/stats/api/nope', { headers: h }), env, T0);
    expect(res.status).toBe(404);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});
