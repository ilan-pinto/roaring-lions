import { describe, it, expect } from 'vitest';
import { openTestD1 } from './test-d1';
import { handleIngest } from './ingest';
import * as stats from './stats';
import type { Env } from './d1';
import { sessionCookieHeader } from './auth';

const T0 = Date.UTC(2026, 8, 27);
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const base = (p: number, t: number, extra: Record<string, unknown>) => ({ v: 1, player: id(p), session: id(100 + p), build: '0.80.0', t, ...extra });
const end = (p: number, t: number, extra: Record<string, unknown> = {}) =>
  base(p, t, { type: 'mission_end', mission: 'beit_sahwan_breach', result: 'victory', tick: 6000, roe: 90, fielded: 5, lost: 0, objectivesDone: 1, objectivesTotal: 1, ...extra });
const all: stats.StatsFilter = { since: 0, testersOnly: false, includeDev: false };

async function seeded() {
  const db = openTestD1();
  const env: Env = { DB: db, ASSETS: { fetch: async () => new Response('') } };
  const send = (events: unknown[]) => handleIngest(new Request('https://g.dev/api/events', { method: 'POST', body: JSON.stringify({ events }) }), env, T0);
  // Player 1 (dani): two breach runs with the new fields.
  await send([
    base(1, T0, { tester: 'dani', type: 'account', reason: 'mission_start', mission: 'beit_sahwan_breach', credits: 300, earned: 300, unlocks: [], tiers: [] }),
    base(1, T0 + 1, { tester: 'dani', type: 'mission_start', mission: 'beit_sahwan_breach', replay: false, deployed: { inf_squad: 3, mbt_lavi: 1 }, fromRoster: {} }),
    end(1, T0 + 2, { tester: 'dani', bought: { inf_squad: 2 }, orders: { move: 10, halt: 2 } }),
    base(1, T0 + 3, { tester: 'dani', type: 'mission_start', mission: 'beit_sahwan_breach', replay: true, deployed: { inf_squad: 3 }, fromRoster: { inf_squad: 2 } }),
    end(1, T0 + 4, { tester: 'dani', bought: {}, orders: { move: 20 } }),
    base(1, T0 + 5, { tester: 'dani', type: 'account', reason: 'purchase', credits: 185, earned: 300, unlocks: [], tiers: ['inf_squad.armour.1'], item: 'inf_squad.armour.1', price: 115 }),
  ]);
  // Player 2: an OLD client -- no loadout, no counts. It counts as a run, never as a zero.
  await send([
    base(2, T0, { type: 'mission_start', mission: 'beit_sahwan_breach', replay: false }),
    end(2, T0 + 1),
  ]);
  // Player 3: sandbox/dev traffic with an account -- excluded by default.
  await send([base(3, T0, { dev: true, type: 'account', reason: 'reset', credits: 0, earned: 0, unlocks: [], tiers: [] })]);
  return { db, env };
}

describe('accounts (GH-254)', () => {
  it('lists the latest snapshot per real player, with a truncated id', async () => {
    const { db } = await seeded();
    expect(await stats.accounts(db, all)).toEqual([
      { player: '00000000', tester: 'dani', lastSeen: T0 + 5, credits: 185, earned: 300, unlocks: [], tiers: ['inf_squad.armour.1'] },
    ]);
  });

  it('honours the tester filter and the dev switch', async () => {
    const { db } = await seeded();
    expect(await stats.accounts(db, { ...all, tester: 'nobody' })).toEqual([]);
    expect(await stats.accounts(db, { ...all, includeDev: true })).toHaveLength(2);
  });
});

describe('loadouts (GH-254)', () => {
  it('means per run over the runs that carry the fields; old-client runs are counted but never as zeros', async () => {
    const { db } = await seeded();
    const [breach] = await stats.loadouts(db, all);
    expect(breach).toMatchObject({ mission: 'beit_sahwan_breach', runs: 3, loadoutRuns: 2, endedRuns: 2 });
    expect(breach.units).toEqual([
      { unit: 'inf_squad', deployed: 3, fromRoster: 1, bought: 1 },
      { unit: 'mbt_lavi', deployed: 0.5, fromRoster: 0, bought: 0 },
    ]);
    expect(breach.orders).toEqual({ move: 15, halt: 1 });
  });

  it('lists missions in campaign order and skips missions nobody started', async () => {
    const { db } = await seeded();
    expect((await stats.loadouts(db, all)).map((r) => r.mission)).toEqual(['beit_sahwan_breach']);
  });
});

describe('routes', () => {
  it('both new routes are behind the login and answer JSON when signed in', async () => {
    const { env } = await seeded();
    const withPw: Env = { ...env, STATS_PASSWORD: 'correct horse battery staple' };
    for (const path of ['/stats/api/accounts', '/stats/api/loadouts']) {
      const anon = await stats.handleStats(new Request(`https://g.dev${path}`), withPw, T0);
      expect(anon.status).toBe(401);
      const cookie = (await sessionCookieHeader('correct horse battery staple', T0)).split(';')[0];
      const res = await stats.handleStats(new Request(`https://g.dev${path}`, { headers: { cookie } }), withPw, T0);
      expect(res.status).toBe(200);
      expect(Array.isArray(await res.json())).toBe(true);
    }
  });
});
