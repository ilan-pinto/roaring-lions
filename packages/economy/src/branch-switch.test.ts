/**
 * GH-1384: the branch switch, CLOSED (the shipped `BRANCHES_OPEN = false`), equals dev on every player-facing output.
 * Literal oracles only: the max-tier stats were generated once from origin/dev's unit JSON by an independent script
 * (base + each linear track, summed across tracks), and the stored bytes are dev's shapes written out by hand.
 * `branch-switch-open.test.ts` flips the switch and shows which of these move.
 */
import { describe, expect, it } from 'vitest';
import { applyUpgrades, BRANCHES_OPEN, maxTiers, readPath, tierPatch, units, type UpgradableUnit } from '@lions/data';
import { shippedBranched } from './branches';
import { ACCOUNT_VERSION, buyUpgradeRun, emptyAccount, migrateAccount } from './brigade';
import { storeInputFor } from './store-input';
import { buyWithCoins } from './stores';
import { ROAR_VERSION, buyTierWithCoins, emptyRoar, migrateRoar, singlePlayerView } from './wallet';

/** GENERATED once from origin/dev (22653c79d, before branched tiers) by an independent script: each KDF
 *  unit at max tier, base + the linear tracks, summed across tracks. A literal oracle: never regenerate it from this branch. */
const DEV_MAX_TIER: Readonly<Record<string, Readonly<Record<string, number>>>> = {
  "air_medevac_heli": {
    "hull.armor.front": 32,
    "hull.armor.rear": 18,
    "hull.armor.side": 25,
    "hull.hp": 1000,
    "sensors.optics": 1.38,
    "sensors.sight_tiles": 14
  },
  "apc_eitan": {
    "hull.armor.front": 275,
    "hull.armor.rear": 112,
    "hull.armor.side": 175,
    "hull.hp": 2000,
    "sensors.optics": 1.25,
    "sensors.sight_tiles": 13,
    "weapons[0].accuracy": 0.7,
    "weapons[0].penetration": 31
  },
  "apc_kipod": {
    "hull.armor.front": 325,
    "hull.armor.rear": 125,
    "hull.armor.side": 200,
    "hull.hp": 2188,
    "sensors.optics": 1.25,
    "sensors.sight_tiles": 13,
    "weapons[0].accuracy": 0.72,
    "weapons[0].penetration": 20
  },
  "at_nlos_team": {
    "hull.armor.front": 12,
    "hull.armor.rear": 12,
    "hull.armor.side": 12,
    "hull.hp": 475,
    "sensors.optics": 1.5,
    "sensors.sight_tiles": 12,
    "weapons[0].accuracy": 0.87,
    "weapons[0].penetration": 1250
  },
  "at_team": {
    "hull.armor.front": 12,
    "hull.armor.rear": 12,
    "hull.armor.side": 12,
    "hull.hp": 475,
    "sensors.optics": 1.38,
    "sensors.sight_tiles": 12,
    "weapons[0].accuracy": 0.85,
    "weapons[0].penetration": 1125
  },
  "attack_drone": {
    "hull.hp": 112,
    "sensors.optics": 1.75,
    "sensors.sight_tiles": 16,
    "weapons[0].accuracy": 1.0,
    "weapons[0].penetration": 600
  },
  "breach_team": {
    "hull.armor.front": 12,
    "hull.armor.rear": 12,
    "hull.armor.side": 12,
    "hull.hp": 550,
    "sensors.optics": 1.63,
    "sensors.sight_tiles": 13,
    "weapons[0].accuracy": 0.82,
    "weapons[0].penetration": 32
  },
  "demo_squad": {
    "hull.armor.front": 12,
    "hull.armor.rear": 12,
    "hull.armor.side": 12,
    "hull.hp": 475,
    "sensors.optics": 1.25,
    "sensors.sight_tiles": 11,
    "weapons[0].accuracy": 0.65,
    "weapons[0].penetration": 10
  },
  "demo_tzav": {
    "hull.armor.front": 475,
    "hull.armor.rear": 150,
    "hull.armor.side": 250,
    "hull.hp": 3250,
    "weapons[0].accuracy": 0.65,
    "weapons[0].penetration": 22
  },
  "dozer_d9": {
    "hull.armor.front": 300,
    "hull.armor.rear": 138,
    "hull.armor.side": 212,
    "hull.hp": 3000,
    "sensors.optics": 1.0,
    "sensors.sight_tiles": 10
  },
  "heli_peten": {
    "hull.armor.front": 50,
    "hull.armor.rear": 22,
    "hull.armor.side": 31,
    "hull.hp": 800,
    "sensors.optics": 2.0,
    "sensors.sight_tiles": 18,
    "weapons[0].accuracy": 0.7,
    "weapons[0].penetration": 150
  },
  "heli_peten_gunship": {
    "hull.armor.front": 47,
    "hull.armor.rear": 27,
    "hull.armor.side": 38,
    "hull.hp": 1041,
    "sensors.optics": 2.0,
    "sensors.sight_tiles": 18,
    "weapons[1].accuracy": 0.9,
    "weapons[1].penetration": 912
  },
  "heli_yanshuf": {
    "hull.armor.front": 37,
    "hull.armor.rear": 16,
    "hull.armor.side": 23,
    "hull.hp": 936,
    "sensors.optics": 1.4,
    "sensors.sight_tiles": 14,
    "weapons[0].accuracy": 0.5,
    "weapons[0].penetration": 17
  },
  "ifv_namer": {
    "hull.armor.front": 525,
    "hull.armor.rear": 150,
    "hull.armor.side": 275,
    "hull.hp": 2750,
    "sensors.optics": 1.38,
    "sensors.sight_tiles": 14,
    "weapons[0].accuracy": 0.8,
    "weapons[0].penetration": 150
  },
  "inf_grenadier": {
    "hull.armor.front": 12,
    "hull.armor.rear": 12,
    "hull.armor.side": 12,
    "hull.hp": 500,
    "sensors.optics": 1.25,
    "sensors.sight_tiles": 10,
    "weapons[0].accuracy": 0.65,
    "weapons[0].penetration": 38
  },
  "inf_medic_squad": {
    "hull.armor.front": 12,
    "hull.armor.rear": 12,
    "hull.armor.side": 12,
    "hull.hp": 450,
    "sensors.optics": 1.25,
    "sensors.sight_tiles": 10
  },
  "inf_squad": {
    "hull.armor.front": 12,
    "hull.armor.rear": 12,
    "hull.armor.side": 12,
    "hull.hp": 500,
    "sensors.optics": 1.25,
    "sensors.sight_tiles": 10,
    "weapons[0].accuracy": 0.7,
    "weapons[0].penetration": 10
  },
  "jeep_shoded": {
    "hull.armor.front": 18,
    "hull.armor.rear": 12,
    "hull.armor.side": 12,
    "hull.hp": 650,
    "sensors.optics": 1.25,
    "sensors.sight_tiles": 13,
    "weapons[0].accuracy": 0.68,
    "weapons[0].penetration": 28
  },
  "mbt_lavi": {
    "hull.armor.front": 735,
    "hull.armor.rear": 158,
    "hull.armor.side": 315,
    "hull.hp": 3750,
    "sensors.optics": 1.5,
    "sensors.sight_tiles": 15,
    "weapons[0].accuracy": 0.95,
    "weapons[0].penetration": 1625
  },
  "mbt_lavi_camo": {
    "hull.armor.front": 735,
    "hull.armor.rear": 158,
    "hull.armor.side": 315,
    "hull.hp": 3750,
    "sensors.optics": 1.5,
    "sensors.sight_tiles": 15,
    "weapons[0].accuracy": 0.95,
    "weapons[0].penetration": 1625
  },
  "mortar_team": {
    "hull.armor.front": 12,
    "hull.armor.rear": 12,
    "hull.armor.side": 12,
    "hull.hp": 438,
    "sensors.optics": 1.13,
    "sensors.sight_tiles": 10,
    "weapons[0].accuracy": 0.6,
    "weapons[0].penetration": 38
  },
  "recon_drone": {
    "hull.hp": 150,
    "sensors.optics": 2.5,
    "sensors.sight_tiles": 19
  },
  "recon_zikit": {
    "hull.hp": 400,
    "hull.suppression_resistance": 0.8,
    "sensors.optics": 2.1,
    "sensors.sight_tiles": 16
  },
  "scout_shachaf": {
    "hull.armor.front": 162,
    "hull.armor.rear": 62,
    "hull.armor.side": 94,
    "hull.hp": 1125,
    "sensors.optics": 2.37,
    "sensors.sight_tiles": 19,
    "weapons[0].accuracy": 0.7,
    "weapons[0].penetration": 22
  },
  "sniper_team": {
    "hull.armor.front": 12,
    "hull.armor.rear": 12,
    "hull.armor.side": 12,
    "hull.hp": 375,
    "sensors.optics": 2.0,
    "sensors.sight_tiles": 19,
    "weapons[0].accuracy": 0.98,
    "weapons[0].penetration": 56
  },
  "spg_cluster": {
    "hull.armor.front": 75,
    "hull.armor.rear": 25,
    "hull.armor.side": 38,
    "hull.hp": 1750,
    "sensors.optics": 1.13,
    "sensors.sight_tiles": 10
  },
  "spg_long_range": {
    "hull.armor.front": 75,
    "hull.armor.rear": 25,
    "hull.armor.side": 38,
    "hull.hp": 1750,
    "sensors.optics": 1.13,
    "sensors.sight_tiles": 10
  },
  "ugv_recon_dog": {
    "hull.hp": 200,
    "sensors.optics": 2.0,
    "sensors.sight_tiles": 15
  },
  "veh_ambulance": {
    "hull.armor.front": 300,
    "hull.armor.rear": 112,
    "hull.armor.side": 188,
    "hull.hp": 2125,
    "sensors.optics": 1.25,
    "sensors.sight_tiles": 12
  },
  "yahalom_squad": {
    "hull.armor.front": 12,
    "hull.armor.rear": 12,
    "hull.armor.side": 12,
    "hull.hp": 475,
    "sensors.optics": 1.25,
    "sensors.sight_tiles": 11,
    "weapons[0].accuracy": 0.65,
    "weapons[0].penetration": 10
  }
};

const LAVI_PRICES = [455, 680, 950];

describe('the branch switch is closed, and the closed build is dev', () => {
  it('is closed, and no branched table is in force', () => {
    expect(BRANCHES_OPEN).toBe(false);
    expect(shippedBranched()).toEqual({});
    expect(ACCOUNT_VERSION).toBe(2);
    expect(ROAR_VERSION).toBe(1);
  });

  it('every KDF unit at max tier reads dev\'s stats, path by path, whatever the picks', () => {
    const shipped = units as unknown as Record<string, UpgradableUnit>;
    expect(Object.keys(DEV_MAX_TIER).length).toBe(30);
    for (const [id, want] of Object.entries(DEV_MAX_TIER)) {
      const u = shipped[id];
      for (const picks of [{}, Object.fromEntries(Object.keys(u.upgrades ?? {}).map((t) => [t, 2 as const]))]) {
        const got = applyUpgrades(u, maxTiers(u), picks);
        for (const [path, v] of Object.entries(want)) expect(readPath(got, path), `${id} ${path}`).toBeCloseTo(v, 6);
      }
    }
  });

  it('a branched tier read on its own (the Garage\'s benefit and preview lines) is the old linear tier 3, whatever the pick', () => {
    const t3 = (units.mbt_lavi.upgrades.firepower.tiers as unknown as Parameters<typeof tierPatch>[0][])[2];
    for (const pick of [undefined, 1, 2]) expect(tierPatch(t3, pick)).toEqual({ 'weapons[0].accuracy': 0.1, 'weapons[0].penetration': 325 });
  });

  it('a credit run onto tier 3 buys the plain tier 3, and a coin tier 3 buys with no branch named, as on dev', () => {
    const a = { ...emptyAccount(), balance: 2000, earned_total: 2000, upgrades: { mbt_lavi: { firepower: 2 } } };
    const run = buyUpgradeRun(a, 'mbt_lavi', 'firepower', 3, 3, LAVI_PRICES);
    expect(run.ok).toBe(true);
    expect(JSON.stringify(run.account)).toBe(
      '{"version":2,"balance":1050,"earned_total":2000,"paid":{},"campaign_paid":{},"unlocks":[],"upgrades":{"mbt_lavi":{"firepower":3}},"grants":[],"coupons":[]}'
    );
    const coin = buyTierWithCoins({ ...emptyRoar(), coins: { free: 500, paid: 0 } }, 'mbt_lavi', 'firepower', 3, 2, 95, 950, 7);
    expect(coin.ok).toBe(true);
    expect(JSON.stringify(coin.account.entitlements.upgrades)).toBe('{"mbt_lavi":{"firepower":{"tier":3,"paidTiers":0}}}');
    // and the Stores' one coin path, the one the app and the Worker share (inf_squad is in the brigade from the start)
    const wallet = { ...emptyRoar(), coins: { free: 500, paid: 0 }, entitlements: { units: {}, upgrades: { inf_squad: { firepower: { tier: 2, paidTiers: 0 } } } } };
    const viaStores = buyWithCoins(storeInputFor({ ledger: {}, brigade: emptyAccount(), roar: wallet }), wallet, { kind: 'tier', unitId: 'inf_squad', track: 'firepower', tier: 3 }, 7);
    expect(viaStores.ok).toBe(true);
    expect(viaStores.account.entitlements.upgrades.inf_squad.firepower).toEqual({ tier: 3, paidTiers: 0 });
    expect(viaStores.account.coins.free).toBe(500 - 35); // coinPrice(305)
  });

  it('a read writes dev\'s bytes: no picks, no marker, no branch, dev\'s versions; and the view holds no pick', () => {
    expect(JSON.stringify(emptyAccount())).toBe('{"version":2,"balance":0,"earned_total":0,"paid":{},"campaign_paid":{},"unlocks":[],"upgrades":{},"grants":[],"coupons":[]}');
    const v2 = { version: 2, balance: 5, earned_total: 2090, paid: {}, campaign_paid: {}, unlocks: [], upgrades: { mbt_lavi: { firepower: 3 } }, grants: [{ source: 'earned', amount: 2090, missionId: 'm', at: 1 }], coupons: [] };
    expect(JSON.stringify(migrateAccount(v2))).toBe(
      '{"version":2,"balance":5,"earned_total":2090,"paid":{},"campaign_paid":{},"unlocks":[],"upgrades":{"mbt_lavi":{"firepower":3}},"grants":[{"source":"earned","amount":2090,"missionId":"m","at":1}],"coupons":[]}'
    );
    // an account an OPEN build wrote reads back to dev's shape too
    const fromOpen = { ...v2, version: 3, picks: { mbt_lavi: { firepower: 2 } }, legacy: { mbt_lavi: { firepower: true } } };
    expect(JSON.stringify(migrateAccount(fromOpen))).toBe(JSON.stringify(migrateAccount(v2)));
    const v1 = {
      version: 1, coins: { free: 3, paid: 0 },
      entitlements: { units: {}, upgrades: { at_team: { sensors: { tier: 3, paidTiers: 0, branch: 2, legacy: true } } } },
      earn: { welcomed: true, campaignDone: false, backfilled: true, missions: {} },
      receipts: [{ kind: 'tier', id: '1-1', at: 1, coins: { free: 20, paid: 0 }, unitId: 'at_team', track: 'sensors', tier: 3, credits: 165, branch: 2, refund: true }],
    };
    expect(JSON.stringify(migrateRoar(v1))).toBe(
      '{"version":1,"coins":{"free":3,"paid":0},"entitlements":{"units":{},"upgrades":{"at_team":{"sensors":{"tier":3,"paidTiers":0}}}},"earn":{"welcomed":true,"campaignDone":false,"backfilled":true,"missions":{}},"receipts":[{"kind":"tier","id":"1-1","at":1,"coins":{"free":20,"paid":0},"unitId":"at_team","credits":165,"track":"sensors","tier":3}]}'
    );
    expect(singlePlayerView(migrateAccount(v2), migrateRoar(v1)).ownedPicks).toEqual({});
  });
});
