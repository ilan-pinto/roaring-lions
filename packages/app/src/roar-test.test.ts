import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TEST_GRANT,
  MAX_TEST_COINS,
  ROAR_TEST_KEY,
  buyTierWithCoins,
  buyUnitWithCoins,
  emptyRoarTest,
  entitlementsOf,
  grantTestCoins,
  loadRoarTest,
  migrateRoarTest,
  networkView,
  seedTestCoins,
  singlePlayerView,
  testCoinsParam,
} from './roar-test';

const q = (s: string): URLSearchParams => new URLSearchParams(s);

describe('?testcoins', () => {
  it('absent means no test mode at all', () => {
    expect(testCoinsParam(q(''))).toBeNull();
    expect(testCoinsParam(q('lang=en'))).toBeNull();
  });
  it('reads n, defaults a bare or bad value, and caps a huge one', () => {
    expect(testCoinsParam(q('testcoins=5000'))).toBe(5000);
    expect(testCoinsParam(q('testcoins'))).toBe(DEFAULT_TEST_GRANT);
    expect(testCoinsParam(q('testcoins=abc'))).toBe(DEFAULT_TEST_GRANT);
    expect(testCoinsParam(q('testcoins=-4'))).toBe(DEFAULT_TEST_GRANT);
    expect(testCoinsParam(q('testcoins=99999999999'))).toBe(MAX_TEST_COINS);
  });
});

describe('the TEST wallet', () => {
  it('seeds once, and a reload does not re-seed; Grant adds and writes a receipt', () => {
    const seeded = seedTestCoins(emptyRoarTest(), 500, 10);
    expect(seeded.coins).toBe(500);
    expect(seedTestCoins({ ...seeded, coins: 20 }, 500, 11).coins).toBe(20);
    const granted = grantTestCoins(seeded, 500, 12);
    expect(granted.coins).toBe(1000);
    expect(granted.receipts.map((r) => r.kind)).toEqual(['grant', 'grant']);
  });

  it('a unit buy spends exactly its coins, marks it coin-bought, and writes a receipt', () => {
    const w = { ...emptyRoarTest(), coins: 400 };
    const { account, ok } = buyUnitWithCoins(w, 'apc_kipod', 320, 3200, 99);
    expect(ok).toBe(true);
    expect(account.coins).toBe(80);
    expect(account.entitlements.units).toEqual({ apc_kipod: { coins: true } });
    expect(account.receipts.at(-1)).toMatchObject({ kind: 'unit', unitId: 'apc_kipod', coins: 320, credits: 3200 });
  });

  it('refuses a short wallet, a repeat, and a non-positive price -- the same object back', () => {
    const w = { ...emptyRoarTest(), coins: 100 };
    expect(buyUnitWithCoins(w, 'apc_kipod', 320, 3200, 1)).toEqual({ account: w, ok: false });
    const bought = buyUnitWithCoins({ ...w, coins: 500 }, 'apc_kipod', 320, 3200, 1).account;
    expect(buyUnitWithCoins(bought, 'apc_kipod', 320, 3200, 2).ok).toBe(false);
    expect(buyUnitWithCoins(w, 'x', 0, 0, 1).ok).toBe(false);
  });

  it('a tier buys only the next rung after the single-player tier', () => {
    const w = { ...emptyRoarTest(), coins: 100 };
    expect(buyTierWithCoins(w, 'mbt_lavi', 'armour', 3, 1, 55, 545, 1).ok).toBe(false);
    const { account, ok } = buyTierWithCoins(w, 'mbt_lavi', 'armour', 2, 1, 55, 545, 1);
    expect(ok).toBe(true);
    expect(account.coins).toBe(45);
    expect(account.entitlements.upgrades).toEqual({ mbt_lavi: { armour: { coins: 2 } } });
  });

  it('round-trips through storage under its own key and drops junk', () => {
    const map = new Map<string, string>();
    const store = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), removeItem: (k: string) => void map.delete(k) };
    map.set(ROAR_TEST_KEY, JSON.stringify({ coins: 7, seeded: true, entitlements: { units: { a: { coins: true }, b: 5 } }, receipts: [{ kind: 'nope' }] }));
    const a = loadRoarTest(store);
    expect(a.coins).toBe(7);
    expect(a.entitlements.units).toEqual({ a: { coins: true } });
    expect(a.receipts).toEqual([]);
    expect(migrateRoarTest('garbage')).toEqual(emptyRoarTest());
  });
});

describe('earned and coin-bought, held apart (spec §1.5)', () => {
  const account = { unlocks: ['breach_team'], upgrades: { mbt_lavi: { armour: 1 } } };
  const roar = {
    ...emptyRoarTest(),
    entitlements: { units: { apc_kipod: { coins: true as const } }, upgrades: { mbt_lavi: { armour: { coins: 3 } } } },
  };

  it('records each source separately', () => {
    expect(entitlementsOf(account, roar)).toEqual({
      units: { breach_team: { earned: true, coins: false }, apc_kipod: { earned: false, coins: true } },
      upgrades: { mbt_lavi: { armour: { earned: 1, coins: 3 } } },
    });
  });

  it('single-player plays earned OR coins, a tier at max(earned, coins)', () => {
    const v = singlePlayerView(account, roar);
    expect([...v.boughtUnits].sort()).toEqual(['apc_kipod', 'breach_team']);
    expect(v.ownedTiers).toEqual({ mbt_lavi: { armour: 3 } });
  });

  it('network play reads earned only', () => {
    const v = networkView(account, roar);
    expect([...v.boughtUnits]).toEqual(['breach_team']);
    expect(v.ownedTiers).toEqual({ mbt_lavi: { armour: 1 } });
  });
});
