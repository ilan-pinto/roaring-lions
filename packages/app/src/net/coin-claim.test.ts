// GH-317, gate G-V1: coin-bought units and tiers never reach a versus room. A coin-only
// account (nothing earned, everything on the coin path) is walked through the three places
// a claim could leak: the create request, the room's world, and the network view.
import { describe, expect, it } from 'vitest';
import { BRANCHES_OPEN } from '@lions/data';
import { sidesOfFactions, validateConfig, type MatchConfig } from '@lions/net';
import { accountView } from '../account-view';
import { memoryLedgerStore } from '../ledger-store';
import { emptyRoar, networkView } from '../roar-wallet';
import { openRoom, roomClaim, type OpenDeps } from './connect';
import { buildMatchWorld, seatKitPicksOf } from './match-world';
import { roomKitTables } from './room-kit';
import { versusRoster } from './versus-roster';

type Tiers = Record<string, Record<string, number>>;

/** An account that earned nothing and bought a unit and two tiers with coins. */
function coinOnly() {
  const store = memoryLedgerStore();
  store.writeRoar({
    ...emptyRoar(),
    coins: { free: 40, paid: 0 },
    entitlements: { units: { apc_kipod: { free: true } }, upgrades: { mbt_lavi: { armour: { tier: 2, paidTiers: 0 } } } },
  });
  return store;
}

describe('G-V1: a coin-only account in a versus room', () => {
  it('the fixture is real: single-player sees the coin kit, the network view sees nothing', () => {
    const store = coinOnly();
    const sp = accountView(store);
    expect(sp.ownedTiers).toEqual({ mbt_lavi: { armour: 2 } });
    expect(sp.boughtUnits.has('apc_kipod')).toBe(true);
    const net = networkView(store.readAccount(), store.readRoar());
    // A track the coin path touched reads 0 on the earned-only view: nothing is owned.
    expect(Object.values(net.ownedTiers).flatMap((t) => Object.values(t)).every((n) => n === 0)).toBe(true);
    expect([...net.boughtUnits]).toEqual([]);
  });

  const answering = () => {
    const calls: Record<string, unknown>[] = [];
    const f = (async (_url: string, init?: RequestInit) => {
      calls.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return Response.json({ code: 'ABCDEF', seat: 0, ticket: 'tk' }, { status: 201 });
    }) as unknown as typeof fetch;
    return { f, calls };
  };
  const depsFor = (f: typeof fetch, tiers: () => Tiers): OpenDeps => ({
    fetch: f,
    origin: 'http://x',
    openSocket: () => ({ send() {}, close() {}, onopen: null, onmessage: null, onclose: null }) as never,
    store: { getItem: () => 'pid', setItem: () => {} },
    session: { getItem: () => null, setItem: () => {} },
    tiers,
  });
  const tick = () => new Promise((r) => setTimeout(r, 0));

  it('a matched create (the default) sends no tiers and no unlocks, whatever the account owns', async () => {
    for (const kit of [{}, { kit: 'matched' as const }]) {
      const { f, calls } = answering();
      void openRoom({ kind: 'create', map: 'tel_marum', callsign: 'Ari', ...kit }, 'b', depsFor(f, () => accountView(coinOnly()).ownedTiers)).catch(() => {});
      await tick();
      expect(calls).toHaveLength(1);
      expect(calls[0].kit).toBe('matched');
      expect(Object.keys(calls[0]).filter((k) => ['tiers', 'unlocks', 'units', 'boughtUnits', 'specials'].includes(k))).toEqual([]);
    }
  });

  it('the one ruled exception, a friends\' brigade room, is the only create that carries the claim (D4, 11 Oct)', async () => {
    const { f, calls } = answering();
    void openRoom({ kind: 'create', map: 'tel_marum', callsign: 'Ari', kit: 'brigade' }, 'b', depsFor(f, () => accountView(coinOnly()).ownedTiers)).catch(() => {});
    await tick();
    expect(calls[0].tiers).toEqual({ mbt_lavi: { armour: 2 } });
  });

  /** A versus config whose seats claim `tiers` under `kit`. */
  function room(tiers: Tiers, kit: 'matched' | 'brigade'): MatchConfig {
    const sides = sidesOfFactions(['kdf', 'kdf']);
    const seat = (s: 0 | 1) => ({ seat: s, side: sides[s], faction: 'kdf', kit, tiers, unlocks: [], player: `p${s}`, callsign: `c${s}`, kind: 'human' });
    const c = validateConfig({ matchId: 'M', code: 'ABCDEF', seed: 1234, map: 'tel_marum', mode: 'versus', seats: [seat(0), seat(1)], pace: { kind: 'realtime' }, hashEveryTicks: 20, bufferTicks: 2, build: 'b', dataDigest: 0 });
    if (c === null) throw new Error('bad fixture');
    return c;
  }

  it('a matched room built from a coin claim is the room built from none: same kit tables, same state hash', () => {
    const claim = accountView(coinOnly()).ownedTiers;
    const withCoins = buildMatchWorld(room(claim, 'matched'));
    const without = buildMatchWorld(room({}, 'matched'));
    for (const me of [0, 1] as const) {
      expect(roomKitTables(withCoins, me).unitKitTiersBySide).toEqual(roomKitTables(without, me).unitKitTiersBySide);
      for (const id of versusRoster().map((u) => u.id)) expect(roomKitTables(withCoins, me).unitKit[id] ?? 0).toBe(0);
    }
    expect(withCoins.sim.hash()).toBe(without.sim.hash());
  });

  it('...and the brigade room does read the claim: the same fixture, kit brigade, differs (so the check above can fail)', () => {
    const claim = accountView(coinOnly()).ownedTiers;
    expect(roomKitTables(buildMatchWorld(room(claim, 'brigade')), 0).unitKit.mbt_lavi).toBeGreaterThan(0);
  });
});

// GH-1384, case 9 (G-V1 for picks), the switch CLOSED as shipped: the claim, the config and the world are dev's,
// whatever the account's picks. `coin-claim-open.test.ts` runs the same gate with the switch flipped open.
describe('G-V1 for picks, closed: no room path reads or writes a pick', () => {
  const PICKS = { mbt_lavi: { firepower: 2 as const } };
  const answering = () => {
    const calls: Record<string, unknown>[] = [];
    const f = (async (_url: string, init?: RequestInit) => {
      calls.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return Response.json({ code: 'ABCDEF', seat: 0, ticket: 'tk' }, { status: 201 });
    }) as unknown as typeof fetch;
    return { f, calls };
  };
  const deps = (f: typeof fetch): OpenDeps => ({
    fetch: f, origin: 'http://x',
    openSocket: () => ({ send() {}, close() {}, onopen: null, onmessage: null, onclose: null }) as never,
    store: { getItem: () => 'pid', setItem: () => {} }, session: { getItem: () => null, setItem: () => {} },
    tiers: () => ({ mbt_lavi: { firepower: 3 } }), picks: () => PICKS, specials: () => [],
  });
  const tick = () => new Promise((r) => setTimeout(r, 0));

  it('the switch is closed here', () => {
    expect(BRANCHES_OPEN).toBe(false);
  });
  it('a brigade create and a join send dev\'s claim keys, tiers and specials, and no picks', async () => {
    for (const req of [{ kind: 'create' as const, map: 'tel_marum', callsign: 'Ari', kit: 'brigade' as const }, { kind: 'join' as const, code: 'ABCDEF', callsign: 'Ari' }]) {
      const { f, calls } = answering();
      void openRoom(req, 'b', deps(f)).catch(() => {});
      await tick();
      expect(calls).toHaveLength(1);
      expect(Object.keys(calls[0]).filter((k) => ['tiers', 'picks', 'specials'].includes(k))).toEqual(['tiers', 'specials']);
      expect(calls[0].tiers).toEqual({ mbt_lavi: { firepower: 3 } });
    }
  });
  it('roomClaim: closed is dev\'s claim; open puts the picks INSIDE the matched rule (a matched create carries neither)', () => {
    const d = { tiers: () => ({ mbt_lavi: { firepower: 3 } }), picks: () => PICKS, specials: () => ['demo_tzav'] };
    expect(roomClaim('brigade', d)).toEqual({ tiers: { mbt_lavi: { firepower: 3 } }, specials: ['demo_tzav'] });
    expect(roomClaim(null, d)).toEqual({ tiers: { mbt_lavi: { firepower: 3 } }, specials: ['demo_tzav'] });
    expect(roomClaim('matched', d)).toEqual({});
    expect(roomClaim('matched', d, true)).toEqual({});
    expect(roomClaim('brigade', d, true)).toEqual({ tiers: { mbt_lavi: { firepower: 3 } }, picks: PICKS, specials: ['demo_tzav'] });
    expect(roomClaim(null, d, true)).toEqual({ tiers: { mbt_lavi: { firepower: 3 } }, picks: PICKS, specials: ['demo_tzav'] });
    expect(roomClaim('brigade', { tiers: d.tiers }, true)).toEqual({ tiers: { mbt_lavi: { firepower: 3 } }, picks: {}, specials: [] });
  });

  type Seat = Parameters<typeof seatKitPicksOf>[0];
  const seat = (over: Record<string, unknown>): Seat => ({ seat: 0, side: 0, faction: 'kdf', kit: 'brigade', tiers: { mbt_lavi: { firepower: 3 } }, unlocks: [], player: 'p', callsign: 'c', kind: 'human', ...over }) as Seat;
  const LAVI3 = { mbt_lavi: { firepower: 3 } };
  it('seatKitPicksOf, closed: slice 1\'s stand-in (branch 1 wherever the tiers reach the branched tier), the config\'s picks never read', () => {
    expect(seatKitPicksOf(seat({ picks: PICKS }), LAVI3, versusRoster())).toEqual({ mbt_lavi: { firepower: 1 } });
    expect(seatKitPicksOf(seat({ picks: PICKS }), { mbt_lavi: { firepower: 2 } }, versusRoster())).toEqual({});
  });
  it('seatKitPicksOf, open: the seat\'s own picks under the tiers\' rule, cleaned against the roster and the tiers', () => {
    const r = versusRoster();
    expect(seatKitPicksOf(seat({ picks: PICKS }), LAVI3, r, true)).toEqual({ mbt_lavi: { firepower: 2 } });
    expect(seatKitPicksOf(seat({ picks: { mbt_lavi: { firepower: 1 } } }), LAVI3, r, true)).toEqual({ mbt_lavi: { firepower: 1 } });
    // A config from before the picks: none, so the branched tier fields the tier below (`applyUpgrades`).
    expect(seatKitPicksOf(seat({}), LAVI3, r, true)).toEqual({});
    // Matched, Sarim, no seat: none, whatever the config says.
    expect(seatKitPicksOf(seat({ picks: PICKS, kit: 'matched' }), LAVI3, r, true)).toEqual({});
    expect(seatKitPicksOf(seat({ picks: PICKS, faction: 'sarim' }), LAVI3, r, true)).toEqual({});
    expect(seatKitPicksOf(undefined, LAVI3, r, true)).toEqual({});
    // Below the branched tier, an unbranched track, a non-branch leaf, a prototype key: dropped.
    expect(seatKitPicksOf(seat({ picks: PICKS }), { mbt_lavi: { firepower: 2 } }, r, true)).toEqual({});
    expect(seatKitPicksOf(seat({ picks: { mbt_lavi: { armour: 2 } } }), { mbt_lavi: { armour: 3 } }, r, true)).toEqual({});
    expect(seatKitPicksOf(seat({ picks: { mbt_lavi: { firepower: 3 } } }), LAVI3, r, true)).toEqual({});
    expect(seatKitPicksOf(seat({ picks: JSON.parse('{"__proto__":{"firepower":2}}') }), LAVI3, r, true)).toEqual({});
  });
  it('a closed brigade room fields the same Lavi from pick 1, pick 2 and none: the envelope (literal 0.95 / 1625)', () => {
    const roomOf = (picks: Record<string, Record<string, 1 | 2>> | undefined): MatchConfig => {
      const sides = sidesOfFactions(['kdf', 'kdf']);
      const s = (n: 0 | 1) => ({ seat: n, side: sides[n], faction: 'kdf', kit: 'brigade', tiers: LAVI3, ...(picks === undefined ? {} : { picks }), unlocks: [], player: `p${n}`, callsign: `c${n}`, kind: 'human' });
      const c = validateConfig({ matchId: 'M', code: 'ABCDEF', seed: 1234, map: 'tel_marum', mode: 'versus', seats: [s(0), s(1)], pace: { kind: 'realtime' }, hashEveryTicks: 20, bufferTicks: 2, build: 'b', dataDigest: 0 });
      if (c === null) throw new Error('bad fixture');
      return c;
    };
    const lavi = (picks: Record<string, Record<string, 1 | 2>> | undefined) => {
      const w = buildMatchWorld(roomOf(picks));
      const u = w.kitBySide[0].registered.find((x) => x.id === 'mbt_lavi') as unknown as { weapons: { accuracy: number; penetration: number }[] };
      return { pen: u.weapons[0].penetration, acc: Math.round(u.weapons[0].accuracy * 100) / 100, hash: w.sim.hash() };
    };
    const none = lavi(undefined);
    expect([none.acc, none.pen]).toEqual([0.95, 1625]);
    expect(lavi({ mbt_lavi: { firepower: 1 } })).toEqual(none);
    expect(lavi({ mbt_lavi: { firepower: 2 } })).toEqual(none);
  });
});
