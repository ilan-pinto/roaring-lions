import { describe, expect, it } from 'vitest';
import type { BranchedTable } from './branches';
import { MAX_COINS, emptyRoar, migrateRoar, migrateTestWallet } from './wallet';

// GH-1385 F5: the field-by-field checks of the two wallet migrations. The shipped wallets only ever hold well-formed
// fields, so a dropped or flipped check (`!isObj(v)`, `> 0`, the receipt shape guard) read the same files the same way.
// Every raw value here is written out by hand and every oracle is a literal.

const hostile = (extra: object = {}) => ({
  coins: 40,
  entitlements: {
    units: { a: null, b: { coins: true }, c: { coins: false }, d: 5, e: { coins: 'yes' } },
    upgrades: {
      u1: { armour: { coins: 2 }, sensors: { coins: 0 }, firepower: null, fx: 'x', neg: { coins: -1 } },
      u2: { armour: { coins: 0 } },
      u3: 'not tracks',
    },
  },
  receipts: [
    null,
    5,
    { kind: 'coupon', id: 'c1', at: 1, coins: 30, couponIds: ['a', 5, null, 'b'] },
    { kind: 'coupon', id: 7, at: 1, coins: 99 }, // id is not a string: dropped whole
    { kind: 'coupon', id: 'c2', at: -1, coins: 99 },
    { kind: 'unit', id: 'u', at: 2, coins: 5, unitId: 'inf_squad', credits: 50 },
    { kind: 'unit', id: 'ux', at: 2, coins: 5, unitId: 3, credits: 50 },
    { kind: 'tier', id: 't', at: 3, coins: 5, unitId: 'inf_squad', track: 'armour', tier: 1, credits: 40 },
    { kind: 'tier', id: 'tx', at: 3, coins: 5, unitId: 'inf_squad', tier: 1, credits: 40 }, // no track
    { kind: 'gift', id: 'g', at: 3, coins: 5, unitId: 'inf_squad', track: 'armour', tier: 1, credits: 40 },
  ],
  ...extra,
});

describe('migrateTestWallet: every field is checked on its own', () => {
  it('a value that is not an object is the empty wallet, and does not throw', () => {
    for (const raw of [null, undefined, 7, 'x', [1]]) expect(migrateTestWallet(raw)).toEqual(emptyRoar());
  });

  it('entitlements: only `coins === true` holds a unit, and only a positive whole coin tier holds a track', () => {
    const w = migrateTestWallet(hostile());
    expect(w.entitlements.units).toEqual({ b: { free: true } });
    expect(w.entitlements.upgrades).toEqual({ u1: { armour: { tier: 2, paidTiers: 0 } } });
  });

  it('receipts: the shape of each is checked, and the balance is the coupon coins capped by what is held', () => {
    const w = migrateTestWallet(hostile());
    expect(w.receipts.map((r) => [r.kind, r.id])).toEqual([['coupon', 'c1'], ['unit', 'u'], ['tier', 't']]);
    const c1 = w.receipts[0];
    expect(c1?.kind === 'coupon' ? c1.couponIds : null).toEqual(['a', 'b']);
    expect(w.coins).toEqual({ free: 30, paid: 0 });
  });

  it('without a whole `coins` balance the wallet holds none, even if coupon receipts say otherwise', () => {
    for (const coins of [undefined, -5, 1.5, '40']) expect(migrateTestWallet(hostile({ coins })).coins).toEqual({ free: 0, paid: 0 });
    expect(migrateTestWallet(hostile({ coins: 10 })).coins.free).toBe(10);
    expect(migrateTestWallet(hostile({ coins: MAX_COINS * 10, receipts: [{ kind: 'coupon', id: 'c', at: 1, coins: MAX_COINS * 5 }] })).coins.free).toBe(MAX_COINS);
  });
});

describe('migrateRoar: a track entitlement is kept whole or dropped', () => {
  const BRANCHED: BranchedTable = { fx_tank: { firepower: { tier: 3, price: 950 } } };
  const read = (track: unknown) => migrateRoar({ entitlements: { upgrades: { fx_tank: { firepower: track } } } }, BRANCHED).entitlements.upgrades['fx_tank'];

  it('a track that is not an object, or has no whole tier, is dropped', () => {
    for (const bad of [null, 7, 'x', { tier: -1 }, { tier: 1.5 }, {}]) expect(read(bad)).toEqual({});
  });

  it('a held legacy marker rides through, and a track without one carries none', () => {
    expect(read({ tier: 3, branch: 1, legacy: true })).toEqual({ firepower: { tier: 3, paidTiers: 0, branch: 1, legacy: true } });
    expect(read({ tier: 3, branch: 1 })).toEqual({ firepower: { tier: 3, paidTiers: 0, branch: 1 } });
    expect(read({ tier: 3, branch: 1, legacy: false })).toEqual({ firepower: { tier: 3, paidTiers: 0, branch: 1 } });
  });
});
