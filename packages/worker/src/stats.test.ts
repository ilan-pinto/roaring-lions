import { describe, it, expect } from 'vitest';
import { openTestD1 } from './test-d1';
import { handleIngest } from './ingest';
import * as stats from './stats';
import type { Env, RateLimiter } from './d1';
import { sessionCookieHeader, signSession, SESSION_COOKIE } from './auth';

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

const PASSWORD = 'correct horse battery staple';
const NOOP_ASSETS = { fetch: async () => new Response('') };

function fakeLimiter(succeeds: boolean): RateLimiter & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    limit: async ({ key }) => {
      calls.push(key);
      return { success: succeeds };
    },
  };
}

async function loggedInCookie(password: string, now: number): Promise<string> {
  const header = await sessionCookieHeader(password, now);
  return header.split(';')[0]; // "stats_session=<value>", suitable for a Cookie request header
}

describe('handleStats', () => {
  it('no secret: 403 on /stats, /stats/api/summary and POST /stats/login', async () => {
    const env: Env = { DB: openTestD1(), ASSETS: NOOP_ASSETS };
    for (const req of [
      new Request('https://g.dev/stats'),
      new Request('https://g.dev/stats/api/summary'),
      new Request('https://g.dev/stats/login', { method: 'POST', body: 'password=x' }),
    ]) {
      const res = await stats.handleStats(req, env, T0);
      expect(res.status).toBe(403);
      expect(res.headers.get('cache-control')).toBe('no-store');
    }
  });

  it('GET /stats without a session shows the login page', async () => {
    const env: Env = { DB: openTestD1(), ASSETS: NOOP_ASSETS, STATS_PASSWORD: PASSWORD };
    const res = await stats.handleStats(new Request('https://g.dev/stats'), env, T0);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.text()).toContain('action="/stats/login"');
  });

  it('GET /stats/api/summary without a session is a 401 JSON error, never HTML', async () => {
    const env: Env = { DB: await seeded(), ASSETS: NOOP_ASSETS, STATS_PASSWORD: PASSWORD };
    const res = await stats.handleStats(new Request('https://g.dev/stats/api/summary'), env, T0);
    expect(res.status).toBe(401);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ error: 'unauthorized' });
  });

  it('wrong password: 401 login page, no Set-Cookie', async () => {
    const env: Env = { DB: openTestD1(), ASSETS: NOOP_ASSETS, STATS_PASSWORD: PASSWORD };
    const req = new Request('https://g.dev/stats/login', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'password=wrong',
    });
    const res = await stats.handleStats(req, env, T0);
    expect(res.status).toBe(401);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(res.headers.get('set-cookie')).toBe(null);
    expect(await res.text()).toContain('That password is not right.');
  });

  it('right password: 303 + Set-Cookie with the exact attributes, then the cookie unlocks the page and the JSON', async () => {
    const env: Env = { DB: await seeded(), ASSETS: NOOP_ASSETS, STATS_PASSWORD: PASSWORD };
    const req = new Request('https://g.dev/stats/login', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'password=' + encodeURIComponent(PASSWORD),
    });
    const res = await stats.handleStats(req, env, T0);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/stats');
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain(`${SESSION_COOKIE}=`);
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('Secure');
    expect(setCookie).toContain('SameSite=Strict');
    expect(setCookie).toContain('Path=/stats');
    expect(setCookie).toContain('Max-Age=604800');

    const cookie = setCookie.split(';')[0];
    const dashboard = await stats.handleStats(new Request('https://g.dev/stats', { headers: { cookie } }), env, T0);
    expect(await dashboard.text()).toContain('Roaring Lions Stats');
    expect(dashboard.headers.get('content-type')).toContain('text/html');

    const api = await stats.handleStats(new Request('https://g.dev/stats/api/summary?range=all', { headers: { cookie } }), env, T0);
    expect(api.status).toBe(200);
    expect(await api.json()).toMatchObject({ players: 2 });
  });

  it('a tampered signature, an expired session and a session signed with a different password all fall back to the login page (and 401 JSON on the API)', async () => {
    const env: Env = { DB: openTestD1(), ASSETS: NOOP_ASSETS, STATS_PASSWORD: PASSWORD };
    const good = await loggedInCookie(PASSWORD, T0);
    const tampered = good.slice(0, -1) + (good.at(-1) === 'A' ? 'B' : 'A');
    const expiredValue = await signSession(PASSWORD, T0 - 1);
    const expired = `${SESSION_COOKIE}=${expiredValue}`;
    const wrongPasswordValue = await signSession('a different password', T0 + 1000);
    const wrongPassword = `${SESSION_COOKIE}=${wrongPasswordValue}`;

    for (const cookie of [tampered, expired, wrongPassword]) {
      const page = await stats.handleStats(new Request('https://g.dev/stats', { headers: { cookie } }), env, T0);
      expect(await page.text()).toContain('action="/stats/login"');
      const api = await stats.handleStats(new Request('https://g.dev/stats/api/summary', { headers: { cookie } }), env, T0);
      expect(api.status).toBe(401);
      expect(await api.json()).toEqual({ error: 'unauthorized' });
    }
  });

  it('LOGIN_LIMIT failing answers 429 and never checks the password (a limiter fake records calls; the password given would have been correct)', async () => {
    const limiter = fakeLimiter(false);
    const env: Env = { DB: openTestD1(), ASSETS: NOOP_ASSETS, STATS_PASSWORD: PASSWORD, LOGIN_LIMIT: limiter };
    const req = new Request('https://g.dev/stats/login', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'cf-connecting-ip': '203.0.113.9' },
      body: 'password=' + encodeURIComponent(PASSWORD),
    });
    const res = await stats.handleStats(req, env, T0);
    expect(res.status).toBe(429);
    expect(res.headers.get('set-cookie')).toBe(null);
    expect(await res.text()).toContain('Too many attempts. Wait a minute and try again.');
    expect(limiter.calls).toEqual(['203.0.113.9']);
  });

  it('a foreign Origin on POST /stats/login is refused with 403', async () => {
    const env: Env = { DB: openTestD1(), ASSETS: NOOP_ASSETS, STATS_PASSWORD: PASSWORD };
    const req = new Request('https://g.dev/stats/login', {
      method: 'POST',
      headers: { origin: 'https://evil.example', 'content-type': 'application/x-www-form-urlencoded' },
      body: 'password=' + encodeURIComponent(PASSWORD),
    });
    const res = await stats.handleStats(req, env, T0);
    expect(res.status).toBe(403);
  });

  it('a login body over 4 KB is rejected with 413 and the password is not checked', async () => {
    const env: Env = { DB: openTestD1(), ASSETS: NOOP_ASSETS, STATS_PASSWORD: PASSWORD };
    const req = new Request('https://g.dev/stats/login', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'password=' + encodeURIComponent(PASSWORD) + '&pad=' + 'x'.repeat(5000),
    });
    const res = await stats.handleStats(req, env, T0);
    expect(res.status).toBe(413);
    expect(res.headers.get('set-cookie')).toBe(null);
  });

  it('GET or POST /stats/logout clears the session cookie and redirects to /stats', async () => {
    const env: Env = { DB: openTestD1(), ASSETS: NOOP_ASSETS, STATS_PASSWORD: PASSWORD };
    for (const method of ['GET', 'POST']) {
      const res = await stats.handleStats(new Request('https://g.dev/stats/logout', { method }), env, T0);
      expect(res.status).toBe(303);
      expect(res.headers.get('location')).toBe('/stats');
      const setCookie = res.headers.get('set-cookie') ?? '';
      expect(setCookie).toContain(`${SESSION_COOKIE}=;`);
      expect(setCookie).toContain('Max-Age=0');
    }
  });

  it('answers an unknown /stats/api path with an uncached 404 once authenticated', async () => {
    const env: Env = { DB: await seeded(), ASSETS: NOOP_ASSETS, STATS_PASSWORD: PASSWORD };
    const cookie = await loggedInCookie(PASSWORD, T0);
    const res = await stats.handleStats(new Request('https://g.dev/stats/api/nope', { headers: { cookie } }), env, T0);
    expect(res.status).toBe(404);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});
