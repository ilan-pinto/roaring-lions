// GH-1384, the PR 1584 review's N3: three lines of the guest's coin Return (`returnLegacy`) that no other case pins. None is
// reachable while `PURCHASES_OPEN` is false, and each wants a literal case before the coin Return goes live. Every wallet
// here is written out by hand (no migration, no buy), the branched table is a literal, and every oracle is a literal number.
import { describe, expect, it } from 'vitest';
import { emptyAccount } from './brigade';
import { returnLegacy } from './branch-legacy';
import type { BranchedTable } from './branches';
import { emptyRoar, type RoarReceipt, type RoarWallet, type TrackEntitlement } from './wallet';

/** One branched track: fx_tank's firepower forks at tier 3, priced 950 credits. */
const BRANCHED: BranchedTable = { fx_tank: { firepower: { tier: 3, price: 950 } } };

type TierReceipt = Extract<RoarReceipt, { kind: 'tier' }>;
const tierReceipt = (id: string, free: number, paid: number, extra: Partial<TierReceipt> = {}): TierReceipt => ({
  kind: 'tier',
  id,
  at: 1,
  coins: { free, paid },
  unitId: 'fx_tank',
  track: 'firepower',
  tier: 3,
  credits: 950,
  ...extra,
});

/** A wallet holding a LEGACY coin tier 3 on fx_tank's firepower (pick 1 and the marker), and nothing else. */
function legacyWallet(coins: { free: number; paid: number }, paidTiers: number, receipts: RoarReceipt[]): RoarWallet {
  const e: TrackEntitlement = { tier: 3, paidTiers, branch: 1, legacy: true };
  return { ...emptyRoar(), coins, entitlements: { units: {}, upgrades: { fx_tank: { firepower: e } } }, receipts };
}

const ret = (w: RoarWallet) => returnLegacy(emptyAccount(), w, 'fx_tank', 'firepower', 9, BRANCHED);

describe('returnLegacy, the coin half: the three lines the review found unpinned (N3)', () => {
  it('a paid tier 3 refunded gives back its paid tier: paidTiers 2 becomes 1 (branch-legacy.ts, the paidTiers decrement)', () => {
    const r = ret(legacyWallet({ free: 0, paid: 0 }, 2, [tierReceipt('1-1', 0, 95)]));
    expect(r.ok).toBe(true);
    expect(r.refund.coins).toEqual({ free: 0, paid: 95 });
    expect(r.roar.entitlements.upgrades['fx_tank']?.['firepower']).toEqual({ tier: 2, paidTiers: 1 });
  });
  it('a free tier 3 refunded leaves the paid tiers alone: paidTiers 2 stays 2', () => {
    const r = ret(legacyWallet({ free: 0, paid: 0 }, 2, [tierReceipt('1-1', 95, 0)]));
    expect(r.refund.coins).toEqual({ free: 95, paid: 0 });
    expect(r.roar.entitlements.upgrades['fx_tank']?.['firepower']).toEqual({ tier: 2, paidTiers: 2 });
  });
  it('the refund is capped at MAX_COINS (1,000,000) in each currency, and reports only what it paid back', () => {
    const r = ret(legacyWallet({ free: 999_950, paid: 999_990 }, 3, [tierReceipt('1-1', 75, 20)]));
    expect(r.ok).toBe(true);
    expect(r.roar.coins).toEqual({ free: 1_000_000, paid: 1_000_000 });
    expect(r.refund.coins).toEqual({ free: 50, paid: 10 });
    // The refund receipt records the same capped split, not the receipt's 75 / 20.
    expect(r.roar.receipts.at(-1)).toEqual({
      kind: 'tier',
      id: '9-2',
      at: 9,
      coins: { free: 50, paid: 10 },
      unitId: 'fx_tank',
      track: 'firepower',
      tier: 3,
      credits: 950,
      refund: true,
    });
  });
  it('a newer refund receipt for the same tier is never read as the purchase: the 80-coin buy is refunded, not the 7', () => {
    const r = ret(legacyWallet({ free: 0, paid: 0 }, 0, [tierReceipt('1-1', 80, 0), tierReceipt('1-2', 7, 0, { refund: true })]));
    expect(r.ok).toBe(true);
    expect(r.refund.coins).toEqual({ free: 80, paid: 0 });
    expect(r.roar.coins).toEqual({ free: 80, paid: 0 });
  });
});
