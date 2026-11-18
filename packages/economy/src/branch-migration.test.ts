/**
 * GH-1384: the stored shapes, versioned. `ACCOUNT_VERSION` 3 adds the account's `picks` and `legacy`;
 * `ROAR_VERSION` 2 adds an entitlement's `branch` and `legacy` and a tier receipt's `branch` and `refund`.
 * Every older save stays loadable: these literal fixtures are the stores as the older builds wrote them, and
 * the shipped table is what the app and the Worker pass (a branched track today is, for example,
 * `mbt_lavi` firepower, whose tier 3 is the branched one).
 */
import { describe, expect, it } from 'vitest';
import { ACCOUNT_VERSION, migrateAccount } from './brigade';
import { ROAR_VERSION, migrateRoar, resetFree } from './wallet';

describe('the account: version 1 and 2 saves migrate to version 3 (literal old saves)', () => {
  it('version numbers, as literals', () => {
    expect(ACCOUNT_VERSION).toBe(3);
    expect(ROAR_VERSION).toBe(2);
  });
  it('a version-2 save holding the old linear tier 3 on a now-branched track takes pick 1 and a marker; value kept', () => {
    const v2 = {
      version: 2, balance: 400, earned_total: 2485, paid: { m: 2485 }, campaign_paid: { m: 2485 }, unlocks: [],
      upgrades: { mbt_lavi: { firepower: 3, armour: 2 }, inf_squad: { armour: 3 } },
      grants: [{ source: 'earned', amount: 2485, missionId: 'm', at: 1 }], coupons: [],
    };
    const a = migrateAccount(v2);
    expect(a.version).toBe(3);
    expect(a.upgrades).toEqual({ mbt_lavi: { firepower: 3, armour: 2 }, inf_squad: { armour: 3 } }); // no tier taken away
    expect(a.balance).toBe(400);
    expect(a.picks).toEqual({ mbt_lavi: { firepower: 1 } }); // neither mbt_lavi's nor inf_squad's armour track is branched
    expect(a.legacy).toEqual({ mbt_lavi: { firepower: true } });
  });
  it('a version-1 save (no campaign_paid, no picks) still loads, and the same rule applies', () => {
    const v1 = { version: 1, balance: 0, earned_total: 950, paid: {}, unlocks: [], upgrades: { dozer_d9: { armour: 3 } }, grants: [{ source: 'earned', amount: 950, missionId: 'x', at: 1 }] };
    const a = migrateAccount(v1);
    expect(a.version).toBe(3);
    expect(a.picks).toEqual({ dozer_d9: { armour: 1 } });
    expect(a.legacy).toEqual({ dozer_d9: { armour: true } });
  });
  it('a version-3 save round-trips byte for byte; a pick below its tier, a stray pick and a bad leaf are dropped', () => {
    const v3 = migrateAccount({
      version: 3, balance: 0, earned_total: 0, paid: {}, campaign_paid: {}, unlocks: [], grants: [], coupons: [],
      upgrades: { mbt_lavi: { firepower: 3 }, at_team: { sensors: 2 } },
      picks: { mbt_lavi: { firepower: 2, armour: 1 }, at_team: { sensors: 2 }, inf_squad: { firepower: 7 } },
      legacy: { at_team: { sensors: true }, mbt_lavi: { firepower: 'yes' } },
    });
    expect(v3.picks).toEqual({ mbt_lavi: { firepower: 2 } });
    expect(v3.legacy).toEqual({});
    expect(migrateAccount(JSON.parse(JSON.stringify(v3)))).toEqual(v3);
  });
});

describe('the wallet: version 1 migrates to version 2 (literal old wallet)', () => {
  it('a coin-bought tier 3 on a branched track takes branch 1 and a marker; its receipts are kept', () => {
    const v1 = {
      version: 1, coins: { free: 12, paid: 0 },
      entitlements: { units: {}, upgrades: { at_team: { sensors: { tier: 3, paidTiers: 0 }, firepower: { tier: 1, paidTiers: 0 } } } },
      earn: { welcomed: true, campaignDone: false, backfilled: true, missions: {} },
      receipts: [{ kind: 'tier', id: '1-1', at: 1, coins: { free: 20, paid: 0 }, unitId: 'at_team', track: 'sensors', tier: 3, credits: 165 }],
    };
    const w = migrateRoar(v1);
    expect(w.version).toBe(2);
    expect(w.entitlements.upgrades.at_team).toEqual({ sensors: { tier: 3, paidTiers: 0, branch: 1, legacy: true }, firepower: { tier: 1, paidTiers: 0 } });
    expect(w.receipts).toEqual(v1.receipts);
    expect(migrateRoar(JSON.parse(JSON.stringify(w)))).toEqual(w);
  });
  it('resetFree drops the free branched tier with its marker (PURCHASES_OPEN is false, so no paid tier is kept)', () => {
    const w = migrateRoar({ entitlements: { units: {}, upgrades: { at_team: { sensors: { tier: 3, paidTiers: 0 } } } } });
    expect(resetFree(w).entitlements.upgrades).toEqual({});
  });
});
