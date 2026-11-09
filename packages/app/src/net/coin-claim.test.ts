// GH-317, gate G-V1: coin-bought units and tiers never reach a versus room. A coin-only
// account (nothing earned, everything on the coin path) is walked through the three places
// a claim could leak: the create request, the room's world, and the network view.
import { describe, expect, it } from 'vitest';
import { sidesOfFactions, validateConfig, type MatchConfig } from '@lions/net';
import { accountView } from '../account-view';
import { memoryLedgerStore } from '../ledger-store';
import { emptyRoar, networkView } from '../roar-wallet';
import { openRoom, type OpenDeps } from './connect';
import { buildMatchWorld } from './match-world';
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
