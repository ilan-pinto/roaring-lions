// GH-1384, case 9: gate G-V1 grows to cover branch picks, with the branch switch FLIPPED OPEN (`vi.mock` of the one
// module that holds it). The lead's Q10: "yes, the same as tiers (D4). Matched rooms carry neither." A coin-only
// account holding a coin-bought branch (the Lavi's firepower, tiers 1 to 3, branch 2) is walked through the create
// request and the room's world. Literals from data/units/kdf/mbt_lavi.json: firepower base accuracy 0.85 and
// penetration 1300, tier 2 +0.06 / +208, branch 1 (fire_control) accuracy +0.10 and branch 2 (long_rod) penetration
// +325, so branch 1 reads 0.95 / 1508, branch 2 0.91 / 1625, and a tier 3 with no pick the tier below, 0.91 / 1508.
// `coin-claim.test.ts` holds the closed build to dev.
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../data/src/branches-open', () => ({ BRANCHES_OPEN: true }));

const { BRANCHES_OPEN } = await import('@lions/data');
const { sidesOfFactions, validateConfig } = await import('@lions/net');
const { accountView } = await import('../account-view');
const { memoryLedgerStore } = await import('../ledger-store');
const { emptyRoar } = await import('../roar-wallet');
const { openRoom } = await import('./connect');
const { buildMatchWorld } = await import('./match-world');
const { roomKitTables } = await import('./room-kit');
const { versusRoster } = await import('./versus-roster');
const { templateKey } = await import('@lions/render');
type OpenDeps = import('./connect').OpenDeps;
type MatchConfig = import('@lions/net').MatchConfig;

type Tiers = Record<string, Record<string, number>>;
type Picks = Record<string, Record<string, 1 | 2>>;
type Fire = { id: string; weapons: { accuracy: number; penetration: number }[] };

/** An account that earned nothing and bought the Lavi's firepower to tier 3, branch 2, with coins. */
function coinBranch() {
  const store = memoryLedgerStore();
  store.writeRoar({
    ...emptyRoar(),
    coins: { free: 40, paid: 0 },
    entitlements: { units: {}, upgrades: { mbt_lavi: { firepower: { tier: 3, paidTiers: 0, branch: 2 } } } },
  });
  return store;
}

const answering = () => {
  const calls: Record<string, unknown>[] = [];
  const f = (async (_url: string, init?: RequestInit) => {
    calls.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return Response.json({ code: 'ABCDEF', seat: 0, ticket: 'tk' }, { status: 201 });
  }) as unknown as typeof fetch;
  return { f, calls };
};
const depsFor = (f: typeof fetch): OpenDeps => {
  const view = () => accountView(coinBranch());
  return {
    fetch: f,
    origin: 'http://x',
    openSocket: () => ({ send() {}, close() {}, onopen: null, onmessage: null, onclose: null }) as never,
    store: { getItem: () => 'pid', setItem: () => {} },
    session: { getItem: () => null, setItem: () => {} },
    tiers: () => view().ownedTiers,
    picks: () => view().ownedPicks,
  };
};
const tick = () => new Promise((r) => setTimeout(r, 0));

/** A versus config whose seats claim `tiers` and `picks` under `kit` (each seat its own pair). */
function room(kit: 'matched' | 'brigade', seats: [[Tiers, Picks | undefined], [Tiers, Picks | undefined]]): MatchConfig {
  const sides = sidesOfFactions(['kdf', 'kdf']);
  const seat = (s: 0 | 1) => ({ seat: s, side: sides[s], faction: 'kdf', kit, tiers: seats[s][0], ...(seats[s][1] === undefined ? {} : { picks: seats[s][1] }), unlocks: [], player: `p${s}`, callsign: `c${s}`, kind: 'human' });
  const c = validateConfig({ matchId: 'M', code: 'ABCDEF', seed: 1234, map: 'tel_marum', mode: 'versus', seats: [seat(0), seat(1)], pace: { kind: 'realtime' }, hashEveryTicks: 20, bufferTicks: 2, build: 'b', dataDigest: 0 });
  if (c === null) throw new Error('bad fixture');
  return c;
}
const LAVI3 = { mbt_lavi: { firepower: 3 } };
const laviOf = (w: ReturnType<typeof buildMatchWorld>, side: 0 | 1) => {
  const u = w.kitBySide[side].registered.find((x) => x.id === 'mbt_lavi') as unknown as Fire;
  return [Math.round(u.weapons[0].accuracy * 100) / 100, u.weapons[0].penetration];
};

describe('G-V1 for picks, open: a coin-bought branch reaches a friends\' brigade room, and never a matched one', () => {
  it('the flip is on, and the fixture is real: the single-player view holds tier 3 on branch 2', () => {
    expect(BRANCHES_OPEN).toBe(true);
    const sp = accountView(coinBranch());
    expect(sp.ownedTiers).toEqual({ mbt_lavi: { firepower: 3 } });
    expect(sp.ownedPicks).toEqual({ mbt_lavi: { firepower: 2 } });
  });

  it('a matched create (the default) sends no tiers, no picks and no unlocks', async () => {
    for (const kit of [{}, { kit: 'matched' as const }]) {
      const { f, calls } = answering();
      void openRoom({ kind: 'create', map: 'tel_marum', callsign: 'Ari', ...kit }, 'b', depsFor(f)).catch(() => {});
      await tick();
      expect(calls).toHaveLength(1);
      expect(calls[0].kit).toBe('matched');
      expect(Object.keys(calls[0]).filter((k) => ['tiers', 'picks', 'unlocks', 'units', 'boughtUnits', 'specials'].includes(k))).toEqual([]);
    }
  });

  it('a brigade create and a join carry the picks beside the tiers (Q10, D4)', async () => {
    for (const req of [{ kind: 'create' as const, map: 'tel_marum', callsign: 'Ari', kit: 'brigade' as const }, { kind: 'join' as const, code: 'ABCDEF', callsign: 'Ari' }]) {
      const { f, calls } = answering();
      void openRoom(req, 'b', depsFor(f)).catch(() => {});
      await tick();
      expect(calls[0].tiers).toEqual({ mbt_lavi: { firepower: 3 } });
      expect(calls[0].picks).toEqual({ mbt_lavi: { firepower: 2 } });
    }
  });

  it('a matched room built from that claim is the room built from none: the same kit tables and the same state hash', () => {
    const v = accountView(coinBranch());
    const withClaim = buildMatchWorld(room('matched', [[v.ownedTiers, v.ownedPicks], [v.ownedTiers, v.ownedPicks]]));
    const without = buildMatchWorld(room('matched', [[{}, undefined], [{}, undefined]]));
    for (const me of [0, 1] as const) {
      expect(roomKitTables(withClaim, me).unitKitTiersBySide).toEqual(roomKitTables(without, me).unitKitTiersBySide);
      for (const id of versusRoster().map((u) => u.id)) expect(roomKitTables(withClaim, me).unitKit[id] ?? 0).toBe(0);
    }
    expect(laviOf(withClaim, 0)).toEqual([0.85, 1300]);
    expect(withClaim.sim.hash()).toBe(without.sim.hash());
  });

  it('positive control: a brigade room reads each pick, so the check above can fail (branch 1 0.95 / 1508, branch 2 0.91 / 1625)', () => {
    const one = buildMatchWorld(room('brigade', [[LAVI3, { mbt_lavi: { firepower: 1 } }], [LAVI3, { mbt_lavi: { firepower: 1 } }]]));
    const two = buildMatchWorld(room('brigade', [[LAVI3, { mbt_lavi: { firepower: 2 } }], [LAVI3, { mbt_lavi: { firepower: 2 } }]]));
    expect(laviOf(one, 0)).toEqual([0.95, 1508]);
    expect(laviOf(two, 0)).toEqual([0.91, 1625]);
    // No pick on a branched tier 3 (a config from before the picks) fields the tier below, never both branches.
    expect(laviOf(buildMatchWorld(room('brigade', [[LAVI3, undefined], [LAVI3, undefined]])), 0)).toEqual([0.91, 1508]);
  });

  it('two seats on the same tiers but different branches run two sim types, drawn from ONE template (both branches wear the tier-3 parts, Q6)', () => {
    const w = buildMatchWorld(room('brigade', [[LAVI3, { mbt_lavi: { firepower: 1 } }], [LAVI3, { mbt_lavi: { firepower: 2 } }]]));
    expect(laviOf(w, 0)).toEqual([0.95, 1508]);
    expect(laviOf(w, 1)).toEqual([0.91, 1625]);
    expect(w.typeOfBySide[1].get('mbt_lavi')).not.toBe(w.typeOfBySide[0].get('mbt_lavi'));
    expect(templateKey('mbt_lavi', 1, roomKitTables(w, 0).unitKitTiersBySide)).toBe('mbt_lavi');
    // The same branch on both seats shares one sim type, as the same tiers always have.
    const same = buildMatchWorld(room('brigade', [[LAVI3, { mbt_lavi: { firepower: 2 } }], [LAVI3, { mbt_lavi: { firepower: 2 } }]]));
    expect(same.typeOfBySide[1].get('mbt_lavi')).toBe(same.typeOfBySide[0].get('mbt_lavi'));
  });
});
