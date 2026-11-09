// GH-1077 (Store/Garage WP8, T12): the nine bought-only KDF units that shipped with no upgrade
// tracks now carry them (docs/campaign/economy/upgrades.md section 3, "GH-1077"). This replaces
// the staging guard `gh1077_staged.test.ts`, deleted in the same commit.
//   - every bought-only KDF unit declares at least two tracks (the Store's panel and the Garage
//     assume a bought unit is upgradable);
//   - every tier price of every KDF track equals the spec 2.2 price rule, computed here from
//     LITERAL multipliers (logistics x m, to the nearest 5, halves to even), never read back from
//     the data. The five units that carry their own prices are NAMED, and each exemption is
//     asserted to actually deviate, so a stale exemption goes red;
//   - the price rule guards PRICES, not DELTAS, so the fitted deltas that the fit's invariants rest
//     on are pinned here as literals too: the foot units' sight steps and the NLOS team's
//     firepower penetration.
import { describe, expect, it } from 'vitest';
import { units } from '@lions/data';
import { isBoughtOnly } from '@lions/sim';
import { kdfUnlockGate } from '../../packages/app/src/kdf-gate';

interface Tier {
  price: number;
  patch: Record<string, number>;
}
type Block = Record<string, { tiers: Tier[] }>;
type UnitJson = { id: string; faction: string; cost: { logistics: number }; upgrades?: Block };
type Entry = (typeof units)[keyof typeof units];

const kdf = (Object.values(units) as Entry[]).filter((u) => u.faction === 'kdf');
const asJson = (u: Entry): UnitJson => u as unknown as UnitJson;
const unitOf = (id: string): UnitJson => {
  const u = kdf.find((x) => x.id === id);
  if (u === undefined) throw new Error(`no KDF unit ${id}`);
  return asJson(u);
};

/** The nine bought-only units that had no tracks before GH-1077 (spec 2.1). */
const NINE = [
  'air_medevac_heli',
  'at_nlos_team',
  'inf_grenadier',
  'inf_medic_squad',
  'mbt_lavi_camo',
  'spg_cluster',
  'spg_long_range',
  'ugv_recon_dog',
  'veh_ambulance',
] as const;
const WITH_FIREPOWER = ['at_nlos_team', 'inf_grenadier', 'mbt_lavi_camo'];

/** The five shipped tracks that carry their own prices (upgrades.md section 1): E5's three, the
 *  re-priced attack_drone and heli_yanshuf. Each must DEVIATE from the rule. */
const EXEMPT = ['attack_drone', 'demo_tzav', 'heli_peten_gunship', 'heli_yanshuf', 'recon_zikit'] as const;

/** Spec 2.2's multipliers, per tier, as literals. */
const MULT: Record<string, readonly [number, number, number]> = {
  armour: [0.4, 0.6, 0.85],
  sensors: [0.33, 0.5, 0.7],
  firepower: [0.5, 0.75, 1.05],
};

/** logistics x m to the nearest 5, halves to even, in integer arithmetic (m in hundredths). */
function rulePrice(logistics: number, m: number): number {
  const num = logistics * Math.round(m * 100); // price x 100
  const q = Math.floor(num / 500);
  const r = num - q * 500;
  const up = r > 250 || (r === 250 && q % 2 === 1);
  return (up ? q + 1 : q) * 5;
}

/** The tracks of `u` whose prices are not the rule's, as `track: got vs want`; empty = fits. */
function ruleDeviations(u: UnitJson): string[] {
  const out: string[] = [];
  for (const [track, { tiers }] of Object.entries(u.upgrades ?? {})) {
    const m = MULT[track];
    if (m === undefined) {
      out.push(`${track}: unknown track`);
      continue;
    }
    const got = tiers.map((t) => t.price);
    const want = m.map((x) => rulePrice(u.cost.logistics, x));
    if (got.length !== want.length || got.some((p, i) => p !== want[i])) out.push(`${track}: ${got.join(',')} vs ${want.join(',')}`);
  }
  return out;
}

const patches = (id: string, track: string, key: string): number[] =>
  (unitOf(id).upgrades?.[track]?.tiers ?? []).map((t) => t.patch[key]);

describe('GH-1077 T12: the bought-only units carry tracks', () => {
  it('the rule itself: halves go to even, and it matches shipped earned prices', () => {
    expect(rulePrice(265, 0.5)).toBe(130); // 132.5 -> 26.5 fives -> 26
    expect(rulePrice(400, 0.33)).toBe(130); // 132
    expect(rulePrice(906, 0.4)).toBe(360); // mbt_lavi armour tier 1 as shipped
    expect(rulePrice(292, 0.75)).toBe(220); // inf_squad firepower tier 2 as shipped
  });

  it('every bought-only KDF unit declares at least two tracks, and the nine are among them', () => {
    const bought = kdf.filter((u) => {
      const gate = kdfUnlockGate(u, new Set());
      return gate !== undefined && isBoughtOnly(gate);
    }).map((u) => u.id);
    expect(bought).toHaveLength(12);
    for (const id of NINE) expect(bought, id).toContain(id);
    for (const id of bought) expect(Object.keys(unitOf(id).upgrades ?? {}).length, id).toBeGreaterThanOrEqual(2);
  });

  it('the nine declare exactly the fitted tracks, three tiers each', () => {
    for (const id of NINE) {
      const block = unitOf(id).upgrades;
      expect(block, id).toBeDefined();
      expect(Object.keys(block ?? {}).sort(), id).toEqual(WITH_FIREPOWER.includes(id) ? ['armour', 'firepower', 'sensors'] : ['armour', 'sensors']);
      for (const { tiers } of Object.values(block ?? {})) expect(tiers.length, id).toBe(3);
    }
  });

  it('the nine\'s prices are the price rule from literal multipliers', () => {
    for (const id of NINE) expect(ruleDeviations(unitOf(id)), id).toEqual([]);
  });

  it('every other KDF track fits the rule, except the five named exemptions', () => {
    for (const u of kdf) {
      const j = asJson(u);
      if (j.upgrades === undefined || (EXEMPT as readonly string[]).includes(j.id)) continue;
      expect(ruleDeviations(j), j.id).toEqual([]);
    }
  });

  it('each exemption really deviates (a stale exemption goes red)', () => {
    for (const id of EXEMPT) {
      expect(unitOf(id).upgrades, id).toBeDefined();
      expect(ruleDeviations(unitOf(id)).length, `${id} no longer deviates: delete it from EXEMPT`).toBeGreaterThan(0);
    }
  });

  it('the Te\'o Howitzer costs 1,350 credits to max (spec T9)', () => {
    const total = Object.values(unitOf('spg_long_range').upgrades ?? {}).flatMap((t) => t.tiers).reduce((s, t) => s + t.price, 0);
    expect(total).toBe(1350);
  });

  it('the nine cost 16,050 credits to max between them', () => {
    const total = NINE.flatMap((id) => Object.values(unitOf(id).upgrades ?? {})).flatMap((t) => t.tiers).reduce((s, t) => s + t.price, 0);
    expect(total).toBe(16050);
  });

  // The rule guards prices; these pin the DELTAS (the review finding from WP1).
  it('the foot units\' sight steps and the NLOS team\'s firepower penetration are pinned', () => {
    expect(patches('at_nlos_team', 'sensors', 'sensors.sight_tiles')).toEqual([1, 2, 3]);
    expect(patches('inf_grenadier', 'sensors', 'sensors.sight_tiles')).toEqual([1, 2, 2]);
    expect(patches('inf_medic_squad', 'sensors', 'sensors.sight_tiles')).toEqual([1, 2, 2]);
    expect(patches('at_nlos_team', 'firepower', 'weapons[0].penetration')).toEqual([80, 160, 250]);
    expect(patches('inf_grenadier', 'firepower', 'weapons[0].penetration')).toEqual([2, 5, 8]);
  });

  it('the camo Lavi\'s deltas equal the Lavi\'s; the medevac\'s front stays +0; the robot\'s armour is hp only', () => {
    const lavi = unitOf('mbt_lavi').upgrades;
    for (const [track, { tiers }] of Object.entries(unitOf('mbt_lavi_camo').upgrades ?? {})) {
      expect(tiers.map((t) => t.patch), track).toEqual(lavi?.[track]?.tiers.map((t) => t.patch));
    }
    expect(patches('air_medevac_heli', 'armour', 'hull.armor.front')).toEqual([0, 0, 0]);
    for (const t of unitOf('ugv_recon_dog').upgrades?.armour.tiers ?? []) expect(Object.keys(t.patch)).toEqual(['hull.hp']);
    for (const id of ['at_nlos_team', 'inf_grenadier', 'inf_medic_squad']) {
      for (const face of ['front', 'side', 'rear']) {
        for (const d of patches(id, 'armour', `hull.armor.${face}`)) expect(d, `${id} ${face}`).toBeLessThanOrEqual(2);
      }
    }
  });
});
