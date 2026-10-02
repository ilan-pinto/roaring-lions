import { describe, expect, it } from 'vitest';
import { units } from '@lions/data';
import type { LedgerData, MissionResult, UnlockGate } from '@lions/sim';
import {
  COIN_PACKS,
  LIFETIME_CREDITS,
  coinPrice,
  meanPay,
  packBonusPercent,
  storeItems,
  tierItem,
  unitItem,
  type StoreInput,
  type StoreUnit,
} from './stores-model';

/** Every KDF unit straight off its JSON, the way `main.ts` hands the garage
 *  its roster -- the authored `unlock` field names mapped to `UnlockGate`. */
function kdfUnits(bought: ReadonlySet<string> = new Set()): StoreUnit[] {
  return Object.values(units)
    .filter((u) => u.faction === 'kdf')
    .map((u) => {
      const raw = 'unlock' in u ? (u.unlock as { roe_rating_min?: number; stars_min?: number; after_mission?: string; price?: number }) : undefined;
      const unlock: UnlockGate | undefined = raw && {
        roeMin: raw.roe_rating_min,
        starsMin: raw.stars_min,
        afterMission: raw.after_mission,
        price: raw.price,
        bought: bought.has(u.id),
      };
      return { id: u.id, name: u.name, unlock, upgrades: 'upgrades' in u ? u.upgrades : undefined };
    });
}

const input = (over: Partial<StoreInput> = {}): StoreInput => ({
  units: kdfUnits(),
  ledger: {},
  credits: 0,
  owned: {},
  ...over,
});

describe('coinPrice: 1 coin = 10 credits, rounded UP to a multiple of 5', () => {
  it('prices the spec table exactly', () => {
    // Spec §1.3's B table, item by item.
    expect(coinPrice(220)).toBe(25);
    expect(coinPrice(720)).toBe(75);
    expect(coinPrice(850)).toBe(85);
    expect(coinPrice(1800)).toBe(180);
    expect(coinPrice(3200)).toBe(320);
    expect(coinPrice(4250)).toBe(425);
    expect(coinPrice(8000)).toBe(800);
    expect(coinPrice(25)).toBe(5);
    expect(coinPrice(950)).toBe(95);
  });

  it('rounds up, never to nearest', () => {
    expect(coinPrice(851)).toBe(90); // 85.1 -> 90, not 85
    expect(coinPrice(801)).toBe(85); // 80.1 -> 85
    expect(coinPrice(1)).toBe(5);
    expect(coinPrice(50)).toBe(5);
    expect(coinPrice(51)).toBe(10);
  });

  it('answers 0 for no price at all', () => {
    expect(coinPrice(0)).toBe(0);
    expect(coinPrice(-5)).toBe(0);
    expect(coinPrice(12.5)).toBe(0);
  });
});

describe('prices are derived from the unit JSON, never keyed', () => {
  it('every priced unit and every rung: coins*10 covers credits, and 5 coins less would not', () => {
    const { units: unitItems, tiers } = storeItems(input());
    let checked = 0;
    for (const u of kdfUnits()) {
      const item = unitItems.find((i) => i.id === u.id);
      if (u.unlock?.price === undefined) {
        expect(item).toBeUndefined();
        continue;
      }
      expect(item?.credits).toBe(u.unlock.price);
      const c = item?.coins ?? -1;
      expect(c % 5).toBe(0);
      expect(c * 10).toBeGreaterThanOrEqual(u.unlock.price);
      expect((c - 5) * 10).toBeLessThan(u.unlock.price);
      checked++;
    }
    for (const tier of tiers) {
      if (tier.next === null) continue;
      const json = kdfUnits().find((u) => u.id === tier.unitId)?.upgrades?.[tier.track]?.tiers[tier.next.tier - 1];
      expect(tier.next.credits).toBe(json?.price);
      expect(tier.next.coins % 5).toBe(0);
      expect(tier.next.coins * 10).toBeGreaterThanOrEqual(tier.next.credits);
      expect((tier.next.coins - 5) * 10).toBeLessThan(tier.next.credits);
      checked++;
    }
    // A sweep that saw nothing would pass forever.
    expect(checked).toBeGreaterThan(40);
  });

  it('a retuned price re-prices itself', () => {
    const shifted = kdfUnits().map((u) =>
      u.id === 'apc_kipod' && u.unlock ? { ...u, unlock: { ...u.unlock, price: 3201 } } : u
    );
    const kipod = storeItems(input({ units: shifted })).units.find((i) => i.id === 'apc_kipod');
    expect(kipod?.coins).toBe(325);
  });
});

describe('packs', () => {
  it('500 / 1,100 / 2,400 / 6,500 coins carry 0 / 10 / 20 / 30% bonus', () => {
    expect(COIN_PACKS.map((p) => p.coins)).toEqual([500, 1100, 2400, 6500]);
    expect(COIN_PACKS.map((p) => p.usdCents)).toEqual([499, 999, 1999, 4999]);
    expect(COIN_PACKS.map((p) => packBonusPercent(p))).toEqual([0, 10, 20, 30]);
  });
});

describe('item states', () => {
  const ratings = (mean: number): LedgerData => ({ 'roe.mission_ratings': { m1: mean } });
  const byId = (i: StoreInput, id: string) => storeItems(i).units.find((u) => u.id === id);

  it('earned by a gate play opened (Conduct 70 met)', () => {
    const item = byId(input({ ledger: ratings(75) }), 'recon_drone');
    expect(item?.state).toBe('earned');
    expect(item?.honest).toEqual({ kind: 'earnedGate' });
  });

  it('earned by credits (the account bought it)', () => {
    const item = byId(input({ units: kdfUnits(new Set(['apc_kipod'])) }), 'apc_kipod');
    expect(item?.state).toBe('earned');
    expect(item?.honest).toEqual({ kind: 'earnedCredits' });
  });

  it('affordable in credits while the gate is shut', () => {
    const item = byId(input({ credits: 400, ledger: ratings(60) }), 'recon_drone');
    expect(item?.state).toBe('affordable');
    expect(item?.honest).toEqual({ kind: 'conduct', floor: 70 });
  });

  it('locked when the credits fall short; the stars line counts missions', () => {
    // 18 stars over 6 graded missions = 3 a mission; 44 - 18 = 26 -> 9 missions.
    const results: Record<string, MissionResult> = {};
    for (let i = 0; i < 6; i++) results[`m${i}`] = { stars: 3, roe: 90, ticks: 0, lost: 0 };
    const item = byId(input({ credits: 1240, ledger: { 'campaign.mission_results': results } }), 'apc_kipod');
    expect(item?.state).toBe('locked');
    expect(item?.honest).toEqual({ kind: 'stars', missions: 9, have: 18, need: 44 });
  });

  it('the stars estimate uses this player\'s own rate', () => {
    // 12 stars over 6 missions = 2 a mission; 32 short -> 16 missions.
    const results: Record<string, MissionResult> = {};
    for (let i = 0; i < 6; i++) results[`m${i}`] = { stars: 2, roe: 90, ticks: 0, lost: 0 };
    const item = byId(input({ ledger: { 'campaign.mission_results': results } }), 'apc_kipod');
    expect(item?.honest).toEqual({ kind: 'stars', missions: 16, have: 12, need: 44 });
  });

  it('off sale (G1): a bought-only unit priced past a lifetime of pay', () => {
    const gunship = byId(input({ credits: 9000 }), 'heli_peten_gunship');
    expect(gunship?.state).toBe('offSale');
    expect(gunship?.honest).toEqual({ kind: 'unreachable', lifetime: LIFETIME_CREDITS });
    // ...while a bought-only unit play CAN reach stays on the shelf.
    const zikit = byId(input({ credits: 0 }), 'recon_zikit');
    expect(zikit?.state).toBe('locked');
    expect(zikit?.honest).toEqual({ kind: 'pay', missions: Math.ceil(4250 / meanPay(undefined)) });
  });

  it('the pay line uses the account\'s own mean pay when it has one', () => {
    const zikit = byId(input({ credits: 250, paid: { a: 200, b: 300 } }), 'recon_zikit');
    expect(zikit?.honest).toEqual({ kind: 'pay', missions: Math.ceil((4250 - 250) / 250) });
  });

  it('a tier of a locked unit asks for the unit first; a maxed track is owned', () => {
    const kipod = kdfUnits().find((u) => u.id === 'apc_kipod');
    if (kipod === undefined) throw new Error('apc_kipod missing');
    const shut = tierItem(kipod, 'armour', input({ credits: 99999 }), false);
    expect(shut.state).toBe('locked');
    expect(shut.honest).toEqual({ kind: 'unlockFirst' });
    const maxed = tierItem(kipod, 'armour', input({ owned: { apc_kipod: { armour: 3 } } }), true);
    expect(maxed.state).toBe('earned');
    expect(maxed.next).toBeNull();
    const next = tierItem(kipod, 'armour', input({ credits: 340, owned: { apc_kipod: { armour: 1 } } }), true);
    expect(next.state).toBe('affordable');
    expect(next.next).toEqual({ tier: 2, credits: 335, coins: 35 });
  });

  it('a starting-roster unit gets no unit card, but its tracks do', () => {
    const items = storeItems(input());
    expect(items.units.some((u) => u.id === 'inf_squad')).toBe(false);
    expect(items.tiers.some((t) => t.unitId === 'inf_squad')).toBe(true);
    expect(unitItem({ id: 'x', name: 'X' }, input()).state).toBe('earned');
  });
});
