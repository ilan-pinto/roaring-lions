/**
 * GH-560 (S-2): a unit's hp must be an Fx. The sim registers a type with `fx.from(hp)`, which is
 * `~~(hp * 65536 + ...)` and WRAPS above 32,767 hp (raw 2^31), so a hull past that registers with a
 * negative bar. Everything downstream is safe once the hp is an Fx: `penetrationHpCost` cannot
 * overflow for any Fx maxHp (the sim test at 32,767 hp pins it). So the binding bound is the Fx
 * ceiling itself, not 0.51 of it (the first version of this file asserted `hp * 65536 * 0.51 < 2^31`,
 * a limit near 64,000 hp that nothing could reach before fx.from wrapped: it could not fail).
 *
 * The census is every unit, at its base and at its top upgrade tier, including a unit that is soft
 * at base and becomes hard only through an upgrade. The hard census is pinned by a literal so an
 * empty one cannot pass, and the checker is run against synthetic units to prove it can fail.
 * Today no authored hull is near the bound (the dearest is 3,750 hp), so the real-data test guards
 * a future hull or tier, and the schema's `maximum` (unit.schema.json) refuses the same at validate:data.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import AjvModule from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { applyUpgrades, maxTiers, units, type UpgradableUnit } from '@lions/data';

/** Front armour in mm at or above which a unit is a hard target (tuning.ts SOFT_ARMOR_LIMIT = 30 mm). */
const SOFT_LIMIT_MM = 30;
/** Every unit type shipped at 6448d111 (the directory count). */
const ALL_TYPES = 50;
/** Hard unit types, base tier OR top tier (the two coincide today: no soft unit becomes hard by an upgrade),
 *  counted by hand at 6448d111: mbt_lavi, ifv_namer, apc_eitan, dozer_d9, heli_peten, scout_shachaf, apc_kipod,
 *  heli_peten_gunship, heli_yanshuf, veh_ambulance, air_medevac_heli, mbt_lavi_camo, spg_long_range, spg_cluster,
 *  aa_remetz, demo_tzav. */
const HARD_TYPES = 16;

interface HullJson extends UpgradableUnit {
  hull: { hp: number; armor: { front: number } };
}

interface Reading {
  id: string;
  tier: 'base' | 'top';
  hp: number;
  hard: boolean;
  /** True when this unit is soft at base and hard at top. */
  becomesHard: boolean;
}

/** One reading per (unit, tier) over `entries`. */
function readings(entries: ReadonlyArray<readonly [string, HullJson]>): Reading[] {
  const out: Reading[] = [];
  for (const [id, base] of entries) {
    const top = applyUpgrades(base, maxTiers(base));
    const becomesHard = base.hull.armor.front < SOFT_LIMIT_MM && top.hull.armor.front >= SOFT_LIMIT_MM;
    for (const [tier, u] of [['base', base], ['top', top]] as const) {
      out.push({ id, tier, hp: u.hull.hp, hard: u.hull.armor.front >= SOFT_LIMIT_MM, becomesHard });
    }
  }
  return out;
}

/** The readings whose hp does not fit an Fx: `hp * 65536` must stay below 2^31. */
const overFx = (rs: Reading[]): Reading[] => rs.filter((r) => r.hp * 65536 >= 2 ** 31);

describe('every unit hp is an Fx, at the base tier and the top tier (GH-560, S-2)', () => {
  const all = readings(Object.entries(units).map(([id, u]) => [id, u as unknown as HullJson] as const));

  it('censuses every unit twice, and exactly the hard types, so a filter that finds none cannot pass', () => {
    expect(all.length).toBe(ALL_TYPES * 2);
    const hardIds = new Set(all.filter((r) => r.hard).map((r) => r.id));
    expect(hardIds.size).toBe(HARD_TYPES);
  });

  it('no unit, hard or soft, is past 32767 hp at either tier', () => {
    expect(overFx(all).map((r) => `${r.id} ${r.tier} ${r.hp}`)).toEqual([]);
  });

  it('the checker itself can fail: a 40000 hp hull, a tier that lifts one past 32767, and a soft hull that an upgrade hardens', () => {
    const huge = { hull: { hp: 40000, armor: { front: 300 } } } as unknown as HullJson;
    const tiered = {
      hull: { hp: 30000, armor: { front: 300 } },
      upgrades: { plating: { tiers: [{ price: 1, patch: { 'hull.hp': 5000 } }] } },
    } as unknown as HullJson;
    const hardens = {
      hull: { hp: 40000, armor: { front: 5 } },
      upgrades: { plating: { tiers: [{ price: 1, patch: { 'hull.armor.front': 60 } }] } },
    } as unknown as HullJson;
    const rs = readings([['huge', huge], ['tiered', tiered], ['hardens', hardens]]);
    expect(overFx(rs).map((r) => `${r.id} ${r.tier}`)).toEqual(['huge base', 'huge top', 'tiered top', 'hardens base', 'hardens top']);
    // The soft-to-hard unit is seen as hard at its top tier and flagged, so a hard-only census would still reach it.
    expect(rs.filter((r) => r.becomesHard).map((r) => `${r.id} ${r.tier} hard=${r.hard}`)).toEqual(['hardens base hard=false', 'hardens top hard=true']);
  });
});

describe('the unit schema refuses an hp an Fx cannot hold (GH-560, S-2)', () => {
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const read = (f: string): object => JSON.parse(readFileSync(join(ROOT, 'data', 'schemas', f), 'utf8')) as object;
  const Ajv2020 = (AjvModule as unknown as { default?: typeof AjvModule }).default ?? AjvModule;
  const ajv = new (Ajv2020 as unknown as new (o: object) => {
    addSchema: (s: object) => unknown;
    compile: (s: object) => (d: unknown) => boolean;
  })({ allErrors: true, strict: false });
  ajv.addSchema(read('common.schema.json'));
  const validateUnit = ajv.compile(read('unit.schema.json'));

  const unit = (hp: number, upgrades?: object): object => ({
    id: 'probe_hull', name: 'Probe', faction: 'kdf', role: 'mbt', cost: { logistics: 100 },
    mobility: { speed_tiles_s: 1 }, sensors: { optics: 1, sight_tiles: 10 },
    hull: { hp, armor: { front: 300, side: 100, rear: 50 } },
    ...(upgrades === undefined ? {} : { upgrades }),
  });
  const withPatch = (delta: number): object => ({ plating: { tiers: [{ price: 5, patch: { 'hull.hp': delta } }] } });

  it('accepts 32767 hp and refuses 32768 and 40000', () => {
    expect(validateUnit(unit(32767))).toBe(true);
    expect(validateUnit(unit(32768))).toBe(false);
    expect(validateUnit(unit(40000))).toBe(false);
  });

  it('accepts a tier patch of +32767 hp and refuses +32768 (the patch is a delta, the sum is the test above)', () => {
    expect(validateUnit(unit(100, withPatch(32767)))).toBe(true);
    expect(validateUnit(unit(100, withPatch(32768)))).toBe(false);
  });
});
