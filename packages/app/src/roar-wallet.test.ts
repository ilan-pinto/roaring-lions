// The Roar-coin wallet (GH-317): its storage rules, its split balance and the
// retired TEST wallet's migration. Each `G-` tag is a gate in the design
// (`docs/superpowers/specs/2026-11-04-roar-coin-wallet-design.md` §8); the
// commit that added it names the one-line mutation that turns it red.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { emptyAccount } from './brigade-account';
import { memoryLedgerStore, newCampaign } from './ledger-store';
import { saveSlot, writeActive, readActive, loadSlot } from './profile';
import {
  LEGACY_TEST_KEY,
  MAX_COINS,
  PURCHASES_OPEN,
  ROAR_KEY,
  buyTierWithCoins,
  buyUnitWithCoins,
  emptyRoar,
  entitlementsOf,
  grantCouponCoins,
  loadRoar,
  migrateRoar,
  migrateTestWallet,
  networkView,
  resetFree,
  singlePlayerView,
  spendable,
  type RoarWallet,
} from './roar-wallet';
import { PREVIEW_WALLET, buyEnabled, storeItems, walletOf } from './ui/stores-model';

const srcRoot = resolve(__dirname, '..', '..');

/** Every non-test TypeScript source under packages/<pkg>/src. */
function sources(dir: string = srcRoot): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sources(p));
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

describe('G-S1: lions.roar has exactly one owner', () => {
  const literal = /(['"])lions\.roar(\.test)?\1/;
  const files = sources();

  it('only roar-wallet.ts spells either key as a string', () => {
    expect(files.length).toBeGreaterThan(100); // a scan over nothing passes forever
    const owners = files.filter((f) => literal.test(readFileSync(f, 'utf8'))).map((f) => f.slice(srcRoot.length + 1));
    expect(owners).toEqual([join('app', 'src', 'roar-wallet.ts')]);
  });

  it('nothing reads the retired lions.roar.test key but the one-time migration', () => {
    const legacy = /lions\.roar\.test/;
    const readers = files.filter((f) => legacy.test(readFileSync(f, 'utf8'))).map((f) => f.slice(srcRoot.length + 1));
    // roar-wallet.ts (the migration); the rest are prose in comments naming the
    // retired key, and none of them may carry it as a string (checked above).
    expect(readers).toContain(join('app', 'src', 'roar-wallet.ts'));
    expect(LEGACY_TEST_KEY).toBe('lions.roar.test');
  });
});

describe('G-S2: a store that throws is an empty wallet, a disabled Buy and no throw', () => {
  const throwing = {
    getItem: (): string | null => {
      throw new Error('SecurityError: site data is blocked');
    },
    setItem: (): void => {
      throw new Error('QuotaExceededError');
    },
    removeItem: (): void => {
      throw new Error('SecurityError');
    },
  };

  it('loadRoar answers the empty wallet', () => {
    expect(() => loadRoar(throwing)).not.toThrow();
    expect(loadRoar(throwing)).toEqual(emptyRoar());
  });

  it('a blocked door answers the empty wallet and a write does nothing', () => {
    const blocked = memoryLedgerStore.blocked();
    expect(blocked.readRoar()).toEqual(emptyRoar());
    expect(() => blocked.writeRoar({ ...emptyRoar(), coins: { free: 9, paid: 0 } })).not.toThrow();
    expect(blocked.readRoar()).toEqual(emptyRoar());
  });

  it('an empty wallet enables no Buy, and neither does the preview', () => {
    const units = [{ id: 'apc_kipod', name: 'Kipod', unlock: { price: 3200 } }];
    const items = storeItems({ units, ledger: {}, credits: 0, owned: {} });
    const all = [...items.units, ...items.tiers];
    expect(all.length).toBeGreaterThan(0);
    expect(all.filter((i) => buyEnabled(i, walletOf(loadRoar(throwing))))).toEqual([]);
    expect(all.filter((i) => buyEnabled(i, PREVIEW_WALLET))).toEqual([]);
  });

  it('garbage under the key reads as empty too', () => {
    const s = memoryLedgerStore({ [ROAR_KEY]: '{not json' });
    expect(s.readRoar()).toEqual(emptyRoar());
  });
});

describe('G-S3: the wallet outlives a new campaign, ?fresh and a slot load', () => {
  const funded = (): RoarWallet => ({
    ...emptyRoar(),
    coins: { free: 120, paid: 0 },
    entitlements: { units: { apc_kipod: { free: true } }, upgrades: { mbt_lavi: { armour: { tier: 2, paidTiers: 0 } } } },
    earn: { welcomed: true, campaignDone: false, missions: { m1: { won: true, stars: 2 } } },
  });

  it('New campaign / ?fresh (newCampaign) leaves lions.roar byte-identical', () => {
    const s = memoryLedgerStore();
    s.writeRoar(funded());
    const before = s.raw(ROAR_KEY);
    expect(before).not.toBeNull();
    newCampaign(s);
    expect(s.raw(ROAR_KEY)).toBe(before);
  });

  it('loading a save slot leaves lions.roar byte-identical, and slots never carry it', () => {
    const s = memoryLedgerStore();
    s.writeRoar(funded());
    const before = s.raw(ROAR_KEY);
    saveSlot(s, 'a', 'Slot', readActive(s), 'test', 1);
    expect(s.raw('lions.saves')).not.toContain('apc_kipod'); // the entitlement is not in the slot
    s.writeRoar({ ...funded(), coins: { free: 7, paid: 0 } });
    const mid = s.raw(ROAR_KEY);
    const slot = loadSlot(s, 'a');
    if (!slot) throw new Error('slot missing');
    writeActive(s, slot);
    expect(s.raw(ROAR_KEY)).toBe(mid);
    expect(mid).not.toBe(before);
  });

  it('the brigade reset clears the FREE half only', () => {
    const s = memoryLedgerStore();
    s.writeAccount({ ...emptyAccount(), balance: 5 });
    const w: RoarWallet = {
      ...funded(),
      coins: { free: 120, paid: 0 },
    };
    s.writeRoar(w);
    s.resetAccount();
    const after = s.readRoar();
    expect(after.coins.free).toBe(0);
    expect(after.entitlements.units).toEqual({});
    expect(after.entitlements.upgrades).toEqual({});
    expect(after.earn).toEqual(emptyRoar().earn);
  });

  it('the reset keeps what a paid coin bought (by construction in the type; the state is unreachable until ST7)', () => {
    const w: RoarWallet = {
      ...emptyRoar(),
      coins: { free: 40, paid: 25 },
      entitlements: { units: { a: { free: true }, b: { paid: true } }, upgrades: { u: { t: { tier: 3, paidTiers: 1 } } } },
      receipts: [
        { kind: 'unit', id: '1', at: 1, coins: { free: 30, paid: 20 }, unitId: 'b', credits: 500 },
        { kind: 'unit', id: '2', at: 2, coins: { free: 10, paid: 0 }, unitId: 'a', credits: 100 },
      ],
    };
    const r = resetFree(w);
    expect(r.coins).toEqual({ free: 0, paid: 25 });
    expect(r.entitlements.units).toEqual({ b: { paid: true } });
    expect(r.entitlements.upgrades).toEqual({ u: { t: { tier: 1, paidTiers: 1 } } });
    expect(r.receipts.map((x) => x.id)).toEqual(['1']);
  });

  it('a reset with no wallet stored writes nothing', () => {
    const s = memoryLedgerStore();
    s.resetAccount();
    expect(s.raw(ROAR_KEY)).toBeNull();
  });
});

describe('G-S5: the TEST wallet migrates once', () => {
  const legacy = {
    version: 1,
    coins: 100_500,
    seeded: true,
    entitlements: { units: { apc_kipod: { coins: true } }, upgrades: { mbt_lavi: { armour: { coins: 2 } } } },
    receipts: [
      { kind: 'grant', id: '10-1', at: 10, coins: 5000 },
      { kind: 'coupon', id: '11-2', at: 11, coins: 100_000, couponIds: ['lead_roar_coins_100k'] },
      { kind: 'unit', id: '12-3', at: 12, unitId: 'apc_kipod', coins: 320, credits: 3200 },
      { kind: 'tier', id: '13-4', at: 13, unitId: 'mbt_lavi', track: 'armour', tier: 2, coins: 55, credits: 545 },
    ],
  };

  it('keeps the entitlements, only the coupon coins, and the unit/tier/coupon receipts as free test receipts', () => {
    const w = migrateTestWallet(legacy);
    expect(w.entitlements.units).toEqual({ apc_kipod: { free: true } });
    expect(w.entitlements.upgrades).toEqual({ mbt_lavi: { armour: { tier: 2, paidTiers: 0 } } });
    // The balance was 100,500: 5,000 of it a ?testcoins grant. Only the coupon's coins carry.
    expect(w.coins).toEqual({ free: 100_000, paid: 0 });
    expect(w.receipts.map((r) => r.kind)).toEqual(['coupon', 'unit', 'tier']);
    expect(w.receipts.every((r) => r.source === 'test' && r.coins.paid === 0)).toBe(true);
    expect(w.earn).toEqual(emptyRoar().earn);
  });

  it('never carries more than the balance still held', () => {
    expect(migrateTestWallet({ ...legacy, coins: 80 }).coins.free).toBe(80);
    expect(migrateTestWallet({ ...legacy, coins: 0 }).coins.free).toBe(0);
  });

  it('a wallet that only ever held a grant carries no coins at all', () => {
    const w = migrateTestWallet({ ...legacy, coins: 5000, receipts: [legacy.receipts[0]] });
    expect(w.coins.free).toBe(0);
    expect(w.receipts).toEqual([]);
  });

  it('the door migrates on first read, writes the new key and deletes the old, and a second read is the same', () => {
    const s = memoryLedgerStore({ [LEGACY_TEST_KEY]: JSON.stringify(legacy) });
    const first = s.readRoar();
    expect(first.coins.free).toBe(100_000);
    expect(s.raw(LEGACY_TEST_KEY)).toBeNull();
    expect(s.raw(ROAR_KEY)).not.toBeNull();
    expect(s.readRoar()).toEqual(first);
  });

  it('a refused write leaves the old key and still answers the migrated wallet', () => {
    const map = new Map<string, string>([[LEGACY_TEST_KEY, JSON.stringify(legacy)]]);
    const store = {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: (k: string) => void map.delete(k),
    };
    expect(loadRoar(store).coins.free).toBe(100_000);
    expect(map.has(LEGACY_TEST_KEY)).toBe(true);
  });

  it('the new key wins when both exist, and the old key is left alone', () => {
    const s = memoryLedgerStore({
      [ROAR_KEY]: JSON.stringify({ ...emptyRoar(), coins: { free: 7, paid: 0 } }),
      [LEGACY_TEST_KEY]: JSON.stringify(legacy),
    });
    expect(s.readRoar().coins.free).toBe(7);
  });

  it('garbage migrates to empty', () => {
    expect(migrateTestWallet('nope')).toEqual(emptyRoar());
  });
});

describe('G-M1: nothing raises coins.paid while purchases are closed', () => {
  it('PURCHASES_OPEN is false', () => {
    expect(PURCHASES_OPEN).toBe(false);
  });

  it('migrateRoar clamps a file that claims paid coins, paid entitlements and paid tiers', () => {
    const w = migrateRoar({
      version: 1,
      coins: { free: 5, paid: 900 },
      entitlements: { units: { a: { paid: true }, b: { free: true } }, upgrades: { u: { t: { tier: 3, paidTiers: 2 } } } },
      receipts: [{ kind: 'unit', id: '1', at: 1, coins: { free: 1, paid: 9 }, unitId: 'a', credits: 10 }],
    });
    expect(w.coins).toEqual({ free: 5, paid: 0 });
    expect(w.entitlements.units).toEqual({ a: { free: true }, b: { free: true } });
    expect(w.entitlements.upgrades.u.t).toEqual({ tier: 3, paidTiers: 0 });
    expect(w.receipts[0].coins).toEqual({ free: 1, paid: 0 });
  });

  it('a coupon lands in the FREE balance', () => {
    const w = grantCouponCoins(emptyRoar(), 100_000, ['x'], 1);
    expect(w.coins).toEqual({ free: 100_000, paid: 0 });
    expect(w.receipts[0].coins).toEqual({ free: 100_000, paid: 0 });
  });

  it('the legacy migration and a reset keep paid at 0', () => {
    expect(migrateTestWallet({ coins: 5, receipts: [{ kind: 'coupon', id: 'a', at: 1, coins: 5, couponIds: [] }] }).coins.paid).toBe(0);
    expect(resetFree(emptyRoar()).coins.paid).toBe(0);
  });

  it('a long walk of every wallet operation never leaves paid above 0', () => {
    let w = grantCouponCoins(emptyRoar(), 1000, ['c'], 1);
    for (let i = 0; i < 5; i++) {
      w = buyUnitWithCoins(w, `u${i}`, 50, 500, 2 + i).account;
      w = buyTierWithCoins(w, `u${i}`, 'armour', 1, 0, 30, 300, 20 + i).account;
      w = migrateRoar(JSON.parse(JSON.stringify(w)));
      expect(w.coins.paid).toBe(0);
    }
    expect(w.coins.free).toBe(1000 - 5 * 80);
  });

  it('the cap holds on the free side', () => {
    expect(grantCouponCoins({ ...emptyRoar(), coins: { free: MAX_COINS - 10, paid: 0 } }, 100, ['x'], 1).coins.free).toBe(MAX_COINS);
  });
});

describe('G-M2: free coins are spent before paid, and the receipt names both halves', () => {
  // A wallet with paid coins is unreachable through the app until ST7, so it is built
  // by hand: the order of spending is decided now so that ST7 changes no code here.
  const rich: RoarWallet = { ...emptyRoar(), coins: { free: 30, paid: 100 } };

  it('a unit: free first, then paid; the receipt halves sum to the price', () => {
    const { account, ok } = buyUnitWithCoins(rich, 'apc_kipod', 50, 500, 9);
    expect(ok).toBe(true);
    expect(account.coins).toEqual({ free: 0, paid: 80 });
    const r = account.receipts.at(-1);
    expect(r?.coins).toEqual({ free: 30, paid: 20 });
    expect((r?.coins.free ?? 0) + (r?.coins.paid ?? 0)).toBe(50);
    expect(account.entitlements.units.apc_kipod).toEqual({ paid: true });
  });

  it('a purchase the free side covers touches no paid coin and records a free entitlement', () => {
    const { account } = buyUnitWithCoins(rich, 'apc_kipod', 25, 250, 9);
    expect(account.coins).toEqual({ free: 5, paid: 100 });
    expect(account.receipts.at(-1)?.coins).toEqual({ free: 25, paid: 0 });
    expect(account.entitlements.units.apc_kipod).toEqual({ free: true });
  });

  it('a tier counts the rungs a paid coin bought', () => {
    const one = buyTierWithCoins(rich, 'u', 'armour', 1, 0, 50, 500, 1).account;
    expect(one.entitlements.upgrades.u.armour).toEqual({ tier: 1, paidTiers: 1 });
    const two = buyTierWithCoins(one, 'u', 'armour', 2, 1, 40, 400, 2).account;
    expect(two.entitlements.upgrades.u.armour).toEqual({ tier: 2, paidTiers: 2 });
    expect(two.receipts.at(-1)?.coins).toEqual({ free: 0, paid: 40 });
  });

  it('refuses when free and paid together fall short', () => {
    expect(buyUnitWithCoins(rich, 'x', 131, 1310, 1).ok).toBe(false);
    expect(spendable(rich)).toBe(130);
  });
});

describe('purchases (ported from the TEST wallet)', () => {
  it('a unit buy spends exactly its coins, marks it coin-bought, and writes a receipt', () => {
    const w = { ...emptyRoar(), coins: { free: 400, paid: 0 } };
    const { account, ok } = buyUnitWithCoins(w, 'apc_kipod', 320, 3200, 99);
    expect(ok).toBe(true);
    expect(account.coins.free).toBe(80);
    expect(account.entitlements.units).toEqual({ apc_kipod: { free: true } });
    expect(account.receipts.at(-1)).toMatchObject({ kind: 'unit', unitId: 'apc_kipod', coins: { free: 320, paid: 0 }, credits: 3200 });
  });

  it('refuses a short wallet, a repeat, and a non-positive price -- the same object back', () => {
    const w = { ...emptyRoar(), coins: { free: 100, paid: 0 } };
    expect(buyUnitWithCoins(w, 'apc_kipod', 320, 3200, 1)).toEqual({ account: w, ok: false });
    const bought = buyUnitWithCoins({ ...w, coins: { free: 500, paid: 0 } }, 'apc_kipod', 320, 3200, 1).account;
    expect(buyUnitWithCoins(bought, 'apc_kipod', 320, 3200, 2).ok).toBe(false);
    expect(buyUnitWithCoins(w, 'x', 0, 0, 1).ok).toBe(false);
  });

  it('a tier buys only the next rung after the single-player tier', () => {
    const w = { ...emptyRoar(), coins: { free: 100, paid: 0 } };
    expect(buyTierWithCoins(w, 'mbt_lavi', 'armour', 3, 1, 55, 545, 1).ok).toBe(false);
    const { account, ok } = buyTierWithCoins(w, 'mbt_lavi', 'armour', 2, 1, 55, 545, 1);
    expect(ok).toBe(true);
    expect(account.coins.free).toBe(45);
    expect(account.entitlements.upgrades).toEqual({ mbt_lavi: { armour: { tier: 2, paidTiers: 0 } } });
  });

  it('round-trips through storage and drops junk', () => {
    const map = new Map<string, string>();
    const store = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), removeItem: (k: string) => void map.delete(k) };
    map.set(
      ROAR_KEY,
      JSON.stringify({ coins: { free: 7 }, entitlements: { units: { a: { free: true }, b: 5 } }, receipts: [{ kind: 'nope' }], earn: { missions: { m: { won: true, stars: 9 } } } })
    );
    const a = loadRoar(store);
    expect(a.coins).toEqual({ free: 7, paid: 0 });
    expect(a.entitlements.units).toEqual({ a: { free: true } });
    expect(a.receipts).toEqual([]);
    expect(a.earn.missions.m).toEqual({ won: true, stars: 3 });
    expect(migrateRoar('garbage')).toEqual(emptyRoar());
    expect(migrateRoar(JSON.parse(JSON.stringify(a)))).toEqual(a);
  });

  it('a coupon receipt survives the round trip, and a coupon of nothing is ignored', () => {
    const w = emptyRoar();
    expect(grantCouponCoins(w, 0, ['x'], 1)).toBe(w);
    const once = grantCouponCoins(w, 30, ['a', 'b'], 2);
    expect(once.receipts).toEqual([{ kind: 'coupon', id: '2-1', at: 2, coins: { free: 30, paid: 0 }, couponIds: ['a', 'b'] }]);
    expect(migrateRoar(JSON.parse(JSON.stringify(once)))).toEqual(once);
  });
});

describe('earned and coin-bought, held apart (spec §1.5)', () => {
  const account = { unlocks: ['breach_team'], upgrades: { mbt_lavi: { armour: 1 } } };
  const roar: RoarWallet = {
    ...emptyRoar(),
    entitlements: { units: { apc_kipod: { free: true } }, upgrades: { mbt_lavi: { armour: { tier: 3, paidTiers: 0 } } } },
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
