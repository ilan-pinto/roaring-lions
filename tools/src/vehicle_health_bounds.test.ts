/**
 * GH-560: the penetration cost is `floor(maxHp * 0.34) * (60 + shift) / 60` in raw Q16.16, so a
 * hard hull's cost is at most 0.51 of its hp. Every shipped hard unit, at its base and at its top
 * upgrade tier, must keep that under 2^31 (the `| 0` in `penetrationHpCost` would otherwise wrap
 * silently). The census is pinned by a literal so an empty one cannot pass.
 *
 * Disclosed: the bound has a wide margin (the dearest hull is 3,750 hp, the limit about 64,000), and
 * an Fx hp tops out at 32,767 anyway, so no authored hull is near it. The check guards a future
 * hull of absurd size, not today's data.
 */
import { describe, expect, it } from 'vitest';
import { applyUpgrades, maxTiers, units, type UpgradableUnit } from '@lions/data';

/** Front armour in mm at or above which a unit is a hard target (tuning.ts SOFT_ARMOR_LIMIT = 30 mm). */
const SOFT_LIMIT_MM = 30;
/** Hard unit types shipped at 6448d111, counted by hand: mbt_lavi, ifv_namer, apc_eitan, dozer_d9, heli_peten,
 *  scout_shachaf, apc_kipod, heli_peten_gunship, heli_yanshuf, veh_ambulance, air_medevac_heli, mbt_lavi_camo,
 *  spg_long_range, spg_cluster, aa_remetz, demo_tzav. */
const HARD_TYPES = 16;

interface HullJson extends UpgradableUnit {
  hull: { hp: number; armor: { front: number } };
}

describe('the penetration cost fits int32 for every shipped hard hull (GH-560)', () => {
  const hard = Object.entries(units).filter(([, u]) => (u as HullJson).hull.armor.front >= SOFT_LIMIT_MM);

  it('censuses exactly the hard types, so a filter that finds none cannot pass', () => {
    expect(hard.length).toBe(HARD_TYPES);
  });

  it('hp * 65536 * 0.51 < 2^31 at the base tier and at the top tier', () => {
    let readings = 0;
    for (const [id, u] of hard) {
      const base = u as unknown as HullJson;
      const top = applyUpgrades(base, maxTiers(base));
      for (const [tier, unit] of [['base', base], ['top', top]] as const) {
        readings++;
        const worst = unit.hull.hp * 65536 * 0.51;
        expect(worst, `${id} at ${tier} tier`).toBeLessThan(2 ** 31);
      }
    }
    expect(readings).toBe(HARD_TYPES * 2);
  });
});
