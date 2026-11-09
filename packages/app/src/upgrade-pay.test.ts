import { describe, expect, it } from 'vitest';
import { buyUpgrade, buyUpgradeRun, emptyAccount, payMission, type BrigadeAccount } from './brigade-account';
import { buyTierWithCoins, emptyRoar, grantCouponCoins, networkView, singlePlayerView, type RoarWallet } from './roar-wallet';
import { creditAsk } from './upgrade-pay';

const PRICES = [160, 240, 340] as const;
const sumLiteral = (lo: number, hi: number): number => {
  // tiers lo..hi inclusive, 1-based, from the literal prices above
  let n = 0;
  for (let t = lo; t <= hi; t++) n += [160, 240, 340][t - 1];
  return n;
};

describe('T17 creditAsk (R3 with R0.1)', () => {
  it.each([
    [0, 0, { from: 1, to: 1, price: 160, again: 0 }],
    [0, 2, { from: 1, to: 3, price: 740, again: 2 }],
    [0, 3, null],
    [3, 3, null],
    [2, 2, { from: 3, to: 3, price: 340, again: 0 }],
    [1, 2, { from: 2, to: 3, price: 580, again: 1 }],
    [2, 0, { from: 3, to: 3, price: 340, again: 0 }],
  ] as const)('earned %i, owned %i', (earned, owned, want) => {
    expect(creditAsk(PRICES, earned, owned)).toEqual(want);
  });
});

describe('buyUpgradeRun refusals', () => {
  const funded = payMission(emptyAccount(), 'm', 2000, 1).account;
  const at1 = buyUpgradeRun(funded, 'u', 'armour', 1, 1, PRICES).account;
  it('from must be earned + 1', () => {
    for (const from of [0, 1, 3]) {
      const r = buyUpgradeRun(at1, 'u', 'armour', from, 3, PRICES);
      expect(r.ok).toBe(false);
      expect(r.account).toBe(at1);
    }
    expect(buyUpgradeRun(at1, 'u', 'armour', 2, 3, PRICES).ok).toBe(true);
  });
  it('to must not be below from', () => {
    const r = buyUpgradeRun(funded, 'u', 'armour', 1, 0, PRICES);
    expect(r.ok).toBe(false);
    expect(r.account).toBe(funded);
  });
  it('every priced tier must be a positive integer', () => {
    for (const bad of [0, -5, 2.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const r = buyUpgradeRun(funded, 'u', 'armour', 1, 3, [160, bad, 340]);
      expect(r.ok).toBe(false);
      expect(r.account).toBe(funded);
    }
  });
  it('GH-1146: the run is priced from the table, so a short table or a tier past it is refused', () => {
    for (const table of [[], [160], [160, 240]]) {
      const r = buyUpgradeRun(funded, 'u', 'armour', 1, 3, table);
      expect(r.ok).toBe(false);
      expect(r.account).toBe(funded);
    }
  });
  it('GH-1146: what leaves the balance is the table sum for from..to, nothing a caller names', () => {
    const r = buyUpgradeRun(at1, 'u', 'armour', 2, 3, PRICES); // tiers 2 and 3 only: 240 + 340
    expect(r.ok).toBe(true);
    expect(at1.balance - r.account.balance).toBe(580);
    // A different table prices the same run differently: the table is the only price input.
    const cheap = buyUpgradeRun(at1, 'u', 'armour', 2, 3, [160, 1, 1]);
    expect(at1.balance - cheap.account.balance).toBe(2);
  });
  it('from and to must be integers', () => {
    const rich = payMission(emptyAccount(), 'm', 100000, 1).account;
    for (const [from, to] of [[1, 2.5], [1, Number.POSITIVE_INFINITY], [1, Number.NaN], [1.5, 2], [Number.NaN, 2]] as const) {
      const r = buyUpgradeRun(rich, 'u', 'armour', from, to, PRICES);
      expect(r.ok).toBe(false);
      expect(r.account).toBe(rich);
    }
  });
  it('the balance must cover the price', () => {
    const poor = payMission(emptyAccount(), 'm', 739, 1).account;
    const r = buyUpgradeRun(poor, 'u', 'armour', 1, 3, PRICES);
    expect(r.ok).toBe(false);
    expect(r.account).toBe(poor);
    expect(buyUpgradeRun(payMission(emptyAccount(), 'm', 740, 1).account, 'u', 'armour', 1, 3, PRICES).ok).toBe(true);
  });
  it('buyUpgrade is the from === to case and keeps its answer', () => {
    expect(buyUpgrade(funded, 'u', 'armour', 1, PRICES)).toEqual(buyUpgradeRun(funded, 'u', 'armour', 1, 1, PRICES));
  });
});

describe('T22 G3: a run writes no grant and moves no earned total', () => {
  it('the balance falls by exactly the price', () => {
    const funded = payMission(emptyAccount(), 'm', 1000, 1).account;
    const r = buyUpgradeRun(funded, 'u', 'armour', 1, 3, PRICES);
    expect(r.ok).toBe(true);
    expect(r.account.balance).toBe(260);
    expect(r.account.earned_total).toBe(1000);
    expect(r.account.grants).toBe(funded.grants);
    expect(r.account.grants).toHaveLength(1);
    expect(r.account.upgrades.u?.armour).toBe(3);
    expect(funded.upgrades).toEqual({});
  });
});

// Deterministic PRNG for the test only (this file is not sim code).
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('T18 G2: credits and coins on one track, against an independent shadow', () => {
  // Epochs alternate a rich start (a full 1..3 run, 740, is affordable) and a poor one.
  const startOf = (epoch: number): number => (epoch % 2 === 0 ? 1200 : 500);
  const COIN_PRICE = [30, 40, 50] as const;
  for (const seed of [1, 7, 42, 99]) {
    it(`a 200-operation walk (seed ${seed}) keeps earned, spend and the network view exact`, () => {
      const rnd = mulberry32(seed);
      let epoch = 0;
      let START = startOf(epoch);
      const fresh = (): { a: BrigadeAccount; w: RoarWallet } => ({
        a: payMission(emptyAccount(), 'm', START, 1).account,
        w: grantCouponCoins(emptyRoar(), 5000, ['c'], 1),
      });
      let { a, w } = fresh();
      // The shadow: written only from literal prices and each call's `ok`.
      let shadowEarned = 0;
      let shadowSpent = 0;
      let shadowCoins = 0;
      let prevEarnedOnAccount = 0;
      let topRuns = 0;
      let creditRuns = 0;
      let coinBuys = 0;
      let refused = 0;
      let nulls = 0;
      for (let i = 0; i < 200; i++) {
        const owned = Math.max(shadowEarned, shadowCoins);
        const r = rnd();
        if (r < 0.35) {
          // R2: a coin buy of the next single-player tier.
          if (owned < 3) {
            const res = buyTierWithCoins(w, 'u', 'armour', owned + 1, owned, COIN_PRICE[owned], 0, 10 + i);
            expect(res.ok).toBe(true);
            w = res.account;
            shadowCoins = owned + 1;
            coinBuys++;
          }
        } else if (r < 0.9) {
          // R3: ask from the views, never from the shadow's own bookkeeping of the account.
          const ask = creditAsk(PRICES, a.upgrades.u?.armour ?? 0, singlePlayerView(a, w).ownedTiers.u?.armour ?? 0);
          if (owned >= 3) {
            expect(ask).toBeNull();
            nulls++;
          } else {
            expect(ask).not.toBeNull();
            if (ask === null) throw new Error('unreachable');
            const expected = sumLiteral(shadowEarned + 1, owned + 1);
            expect(ask).toEqual({ from: shadowEarned + 1, to: owned + 1, price: expected, again: owned - shadowEarned });
            const res = buyUpgradeRun(a, 'u', 'armour', ask.from, ask.to, PRICES);
            const affordable = START - shadowSpent >= expected;
            expect(res.ok).toBe(affordable);
            if (affordable) {
              a = res.account;
              shadowEarned = ask.to;
              shadowSpent += expected;
              creditRuns++;
              if (ask.to === 3) {
                topRuns++;
                // The run reached the top tier: both views and the balance agree, right here.
                expect(a.upgrades.u?.armour).toBe(3);
                expect(networkView(a, w).ownedTiers.u?.armour).toBe(3);
                expect(singlePlayerView(a, w).ownedTiers.u?.armour).toBe(3);
                expect(a.balance).toBe(START - shadowSpent);
              }
            } else {
              expect(res.account).toBe(a);
              refused++;
            }
          }
        } else {
          // A run whose `from` skips a tier (stale) is refused whatever the balance.
          // GH-1146: the run prices itself from the table, so there is no price to forge.
          const res = buyUpgradeRun(a, 'u', 'armour', shadowEarned + 2, shadowEarned + 2, PRICES);
          expect(res.ok).toBe(false);
          expect(res.account).toBe(a);
        }
        // Invariants, every step.
        expect(a.upgrades.u?.armour ?? 0).toBe(shadowEarned);
        expect(networkView(a, w).ownedTiers.u?.armour ?? 0).toBe(shadowEarned);
        expect(singlePlayerView(a, w).ownedTiers.u?.armour ?? 0).toBe(Math.max(shadowEarned, shadowCoins));
        // Account side: what left the balance covers the literal prices of every tier now held.
        expect(START - a.balance).toBeGreaterThanOrEqual(sumLiteral(1, a.upgrades.u?.armour ?? 0));
        expect(a.balance).toBe(START - shadowSpent);
        expect(a.earned_total).toBe(START);
        expect(a.grants).toHaveLength(1);
        const now = Math.max(shadowEarned, shadowCoins);
        const earnedOnAccount = a.upgrades.u?.armour ?? 0;
        expect(earnedOnAccount).toBeGreaterThanOrEqual(prevEarnedOnAccount);
        prevEarnedOnAccount = earnedOnAccount;
        // New epoch once the track is full, so the walk keeps exercising short balances.
        if (now >= 3 && rnd() < 0.5) {
          epoch++;
          START = startOf(epoch);
          ({ a, w } = fresh());
          shadowEarned = shadowSpent = shadowCoins = prevEarnedOnAccount = 0;
        }
      }
      // The walk must have reached the interesting cases, or it proves nothing.
      expect(creditRuns).toBeGreaterThan(5);
      expect(coinBuys).toBeGreaterThan(5);
      expect(topRuns).toBeGreaterThan(0);
      expect(refused).toBeGreaterThan(0);
      expect(nulls).toBeGreaterThan(0);
    });
  }
});
