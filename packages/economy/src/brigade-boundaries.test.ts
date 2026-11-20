import { describe, expect, it } from 'vitest';
import { emptyAccount, migrateAccount, redeemCoupon, type Coupon } from './brigade';

// GH-1385 F5: two `> 0` boundaries of brigade.ts that no shipped data sits on. Every input is a literal.

describe('campaign_paid is read against the lifetime best, mission by mission', () => {
  const read = (paid: Record<string, number>, campaign_paid: Record<string, number>) =>
    migrateAccount({ version: 2, balance: 0, earned_total: 0, paid, campaign_paid }).campaign_paid;

  it('a lifetime best of exactly 1 keeps its campaign entry (the cap is positive, not above 1)', () => {
    expect(read({ m1: 1 }, { m1: 1 })).toEqual({ m1: 1 });
  });

  it('a mission with a lifetime best of 0, or none, keeps no campaign entry', () => {
    expect(read({ m1: 0 }, { m1: 1 })).toEqual({});
    expect(read({}, { m1: 5 })).toEqual({});
  });

  it('an entry above the lifetime best is clamped to it, and one at or below it is kept as is', () => {
    expect(read({ m1: 40, m2: 40, m3: 40 }, { m1: 90, m2: 40, m3: 7 })).toEqual({ m1: 40, m2: 40, m3: 7 });
  });
});

describe('redeemCoupon: a grant entry exists exactly for the credits a coupon pays', () => {
  const hash = (t: string): string => t;
  const table: readonly Coupon[] = [
    { id: 'one', sha256: 'ONE', credits: 1 },
    { id: 'coins-only', sha256: 'COINS', coins: 50 },
    { id: 'zero', sha256: 'ZERO', credits: 0, coins: 5 },
  ];

  it('a 1-credit coupon is granted: balance 1 and one entry of amount 1', () => {
    const r = redeemCoupon(emptyAccount(), 'ONE', table, hash, 100);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.credits).toBe(1);
    expect(r.account.balance).toBe(1);
    expect(r.account.grants).toEqual([{ source: 'granted', amount: 1, couponId: 'one', at: 100 }]);
  });

  it('a coupon that pays no credits writes no grant entry, only its coins', () => {
    for (const code of ['COINS', 'ZERO']) {
      const r = redeemCoupon(emptyAccount(), code, table, hash, 100);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.account.grants).toEqual([]);
      expect(r.account.balance).toBe(0);
    }
  });
});
