/**
 * GH-1197 Phase 1: the munition table and the 155 anchor.
 *
 * Every oracle is a LITERAL from the lead-approved design
 * (`docs/superpowers/specs/2026-11-09-explosion-scale-and-building-physics-design.md`, §2 and the 155 table)
 * or is read from the weapon JSON the sim loads, never from `munitions.ts`'s own arithmetic.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FIRE_SUPPORT, fx } from '@lions/sim';
import { munitionHitStopMs, munitionLightSpec, munitionShake } from './blast-spec';
import {
  FIREBALL_DURATION_MS,
  MUNITIONS,
  classBlastRecipe,
  drawsClassBlast,
  flipbookFireRadius,
  flipbookSmokeRadius,
  munitionCraterTiles,
  munitionFireballTiles,
  munitionForSupport,
  munitionForWeapon,
  munitionRow,
  munitionScorchTiles,
  RAGDOLL_PUSH_DEFAULT,
  ragdollPushFor,
  ragdollPushForWeapon,
  ragdollPushForKill,
  LATCH_AIR_STRIKE,
  LATCH_PLACED_CHARGE,
  recipeCount,
  ringSpecFor,
  type MunitionClassId,
  type MunitionsTable,
} from './munitions';
import { FLIPBOOK_SMOKE_ALPHA } from './units/flipbook-fx';

const UNITS_DIR = new URL('../../../../data/units/', import.meta.url);

interface WeaponJson {
  id: string;
  splash_tiles?: number;
  submunitions?: { splash_tiles: number };
}

/** Every weapon on the roster, as authored (a weapon id can carry a different splash per unit: `warhead`). */
function rosterWeapons(): WeaponJson[] {
  const out: WeaponJson[] = [];
  const walk = (dir: URL): void => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      if (ent.isDirectory()) walk(new URL(`${ent.name}/`, dir));
      else if (ent.name.endsWith('.json')) {
        const u = JSON.parse(readFileSync(new URL(ent.name, dir), 'utf8')) as { weapons?: WeaponJson[] };
        for (const w of u.weapons ?? []) out.push(w);
      }
    }
  };
  walk(UNITS_DIR);
  return out;
}

function hasReach(w: WeaponJson): boolean {
  return (w.splash_tiles ?? 0) > 0 || w.submunitions !== undefined;
}

function munitionOf(w: WeaponJson) {
  return munitionForWeapon(w.id, w.splash_tiles ?? 0, w.submunitions?.splash_tiles ?? 0);
}

function weapon(id: string): WeaponJson {
  const w = rosterWeapons().find((x) => x.id === id);
  if (!w) throw new Error(`no weapon ${id} on the roster`);
  return w;
}

describe('every weapon with a reach has a class (check a)', () => {
  it('maps every weapon with splash_tiles or submunitions', () => {
    const reach = rosterWeapons().filter(hasReach);
    // The roster has a dozen; an empty sweep would pass vacuously.
    expect(reach.length).toBeGreaterThanOrEqual(12);
    const unmapped = [...new Set(reach.filter((w) => munitionOf(w) === null).map((w) => w.id))];
    expect(unmapped, 'weapons with a reach and no munition class').toEqual([]);
  });

  it('maps no weapon the roster does not carry, and names only classes the table has', () => {
    const ids = new Set(rosterWeapons().map((w) => w.id));
    for (const [id, cls] of Object.entries(MUNITIONS.weapons)) {
      expect(ids.has(id), id).toBe(true);
      expect(() => munitionRow(cls)).not.toThrow();
    }
    for (const cls of [...Object.values(MUNITIONS.support), ...Object.values(MUNITIONS.charge)]) {
      expect(() => munitionRow(cls as MunitionClassId)).not.toThrow();
    }
  });

  it('gives every mapped weapon with a reach a ring of its own splash', () => {
    for (const w of rosterWeapons().filter(hasReach)) {
      const m = munitionOf(w);
      expect(m, w.id).not.toBeNull();
      const s = (w.splash_tiles ?? 0) > 0 ? (w.splash_tiles as number) : (w.submunitions?.splash_tiles as number);
      expect(m?.splash, w.id).toBe(s);
      if (m?.cls !== 'blade') expect(ringSpecFor(m!)?.splash, w.id).toBe(s);
    }
  });

  it('is a cluster round sized by its bomblets, and the grenade class draws no outer wave', () => {
    const m = munitionOf(weapon('dpicm_155'));
    expect(m).toEqual({ cls: 'grenade', splash: 0.8 });
    expect(ringSpecFor(m!)?.outerK).toBe(1);
  });
});

describe("the Te'o 155 anchor, the design's 155 table (literals)", () => {
  // The heavy row itself, at the 155's literal splash: these cases pin the ROW. Whether the howitzer reaches it
  // is the first case (and the coverage case above).
  const m = { cls: 'heavy_artillery', splash: 2.4 } as const;
  const row = munitionRow(m.cls);

  it('reads its splash from the weapon JSON and draws its own class', () => {
    expect(munitionOf(weapon('howitzer_155'))).toEqual({ cls: 'heavy_artillery', splash: 2.4 });
    expect(drawsClassBlast(m)).toBe(true);
  });

  it('fireball 1.2, crater 0.96, scorch 1.44', () => {
    expect(munitionFireballTiles(row, m.splash)).toBeCloseTo(1.2, 9);
    expect(munitionCraterTiles(row, m.splash)).toBeCloseTo(0.96, 9);
    expect(munitionScorchTiles(row, m.splash)).toBeCloseTo(1.44, 9);
  });

  it('light 3.2 over 6 t for 450 ms, shake 4 px for 360 ms falling off over 12 t, no hit-stop', () => {
    expect(munitionLightSpec(row, m.splash)).toEqual({ color: 'vfx.fire', intensity: 3.2, radius_tiles: 6, decay_ms: 450 });
    expect(munitionShake(row)).toEqual({ amplitudePx: 4, durationMs: 360, falloffTiles: 12 });
    expect(munitionHitStopMs(row)).toBe(0);
  });

  it('rings: inner 2.4 t in 260 ms, outer to 3.84 t by 520 ms', () => {
    const spec = ringSpecFor(m)!;
    expect(spec.splash).toBe(2.4);
    expect(spec.innerMs).toBe(260);
    expect(spec.outerK * spec.splash).toBeCloseTo(3.84, 9);
    expect(spec.outerEndMs).toBe(520);
    expect(spec.innerColor).toBe('vfx.white_hot');
    expect(spec.outerColor).toBe('dust.2');
  });

  it('the recipe: one fireball of r 1.2 t at 200 ms, 5 lobes, 36 dirt, a 14-billow column, a 20-billow skirt: 76', () => {
    const recipe = classBlastRecipe(row, m.splash);
    expect(recipe.map((l) => [l.type, l.count])).toEqual([
      ['fire', 1],
      ['fire', 5],
      ['dirt', 36],
      ['smoke', 14],
      ['smoke', 20],
    ]);
    expect(recipeCount(recipe)).toBe(76);
    expect(flipbookFireRadius(recipe[0].scale.base, 200, FIREBALL_DURATION_MS)).toBeCloseTo(1.2, 6);
    // The lobes come to rest 2.0 t out (the fire billow's drag is 4/s).
    expect(recipe[1].velocity.radial[0] / 4).toBeCloseTo(2.0, 9);
  });

  it('throws its dirt 2.4 t out with a 3.0 t apex', () => {
    const dirt = classBlastRecipe(row, m.splash)[2];
    const up = dirt.velocity.up[1];
    expect((up * up) / (2 * 9.8)).toBeCloseTo(3.0, 6);
    expect(dirt.velocity.radial[1] * ((2 * up) / 9.8)).toBeCloseTo(2.4, 6);
  });

  it('keeps its dust under the design ceilings: column 0.45, skirt 0.35', () => {
    const recipe = classBlastRecipe(row, m.splash);
    expect((recipe[3].alpha ?? 1) * FLIPBOOK_SMOKE_ALPHA).toBeCloseTo(0.45, 9);
    expect((recipe[4].alpha ?? 1) * FLIPBOOK_SMOKE_ALPHA).toBeCloseTo(0.35, 9);
  });

  it('stands its column 4.0 t high at 3 s, and keeps its skirt inside the outer wave', () => {
    const recipe = classBlastRecipe(row, m.splash);
    const up = recipe[3].velocity.up[1];
    // flipbook-fx.ts's smoke: vel * (1 - exp(-1.2 age)) / 1.2 + 0.22 age.
    expect((up * (1 - Math.exp(-3.6))) / 1.2 + 0.22 * 3).toBeCloseTo(4.0, 6);
    const skirt = recipe[4];
    const far = skirt.velocity.radial[1] / 1.2;
    const biggest = flipbookSmokeRadius(skirt.scale.base + (skirt.scale.rand ?? 0), 0.5);
    expect(far + biggest).toBeLessThanOrEqual(3.84 + 1e-9);
    expect(skirt.velocity.radial[0] / 1.2).toBeGreaterThan(2.4);
  });
});

describe('the Grad shares the heavy class (the lead, 9 Nov), at its own splash', () => {
  const m = { cls: 'heavy_artillery', splash: 3 } as const;
  const row = munitionRow(m.cls);
  it('fireball 1.5, crater 1.2, scorch 1.8, light radius 7.5, rings 3.0 / 4.8', () => {
    expect(munitionOf(weapon('grad_122'))).toEqual({ cls: 'heavy_artillery', splash: 3 });
    expect(munitionFireballTiles(row, 3)).toBeCloseTo(1.5, 9);
    expect(munitionCraterTiles(row, 3)).toBeCloseTo(1.2, 9);
    expect(munitionScorchTiles(row, 3)).toBeCloseTo(1.8, 9);
    expect(munitionLightSpec(row, 3)?.radius_tiles).toBeCloseTo(7.5, 9);
    expect(ringSpecFor(m)!.outerK * 3).toBeCloseTo(4.8, 9);
  });
  it('spends no more than the cap of 76 billows: the dirt gives way', () => {
    expect(recipeCount(classBlastRecipe(row, 3))).toBe(76);
  });
});

describe('only heavy artillery draws its row in Phase 1 (the brief, coordinator ruling Q1)', () => {
  it('every other class keeps its emitter', () => {
    const drawn = Object.entries(MUNITIONS.classes)
      .filter(([, r]) => r?.blast_from === 'class')
      .map(([c]) => c);
    expect(drawn).toEqual(['heavy_artillery']);
    expect(drawsClassBlast(munitionOf(weapon('mortar_82'))!)).toBe(false);
    expect(drawsClassBlast(munitionOf(weapon('gl_40'))!)).toBe(false);
  });
});

describe('the fireball order: grenade < mortar < heavy < strike (check d)', () => {
  // Each class's range of drawn fireballs over the weapons that fire it, the strike at the sim's own splash.
  function range(cls: MunitionClassId): [number, number] {
    const sizes = rosterWeapons()
      .filter(hasReach)
      .map((w) => munitionOf(w))
      .filter((m) => m !== null && m.cls === cls)
      .map((m) => munitionFireballTiles(munitionRow(m!.cls), m!.splash));
    if (cls === 'air_strike') sizes.push(munitionFireballTiles(munitionRow(cls), fx.toNumber(FIRE_SUPPORT[0].splash)));
    expect(sizes.length, cls).toBeGreaterThan(0);
    return [Math.min(...sizes), Math.max(...sizes)];
  }
  it('every class fireball is larger than the class below it', () => {
    const order: MunitionClassId[] = ['grenade', 'mortar', 'heavy_artillery', 'air_strike'];
    for (let i = 1; i < order.length; i++) {
      const [, lowMax] = range(order[i - 1]);
      const [highMin] = range(order[i]);
      expect(lowMax, `${order[i - 1]} < ${order[i]}`).toBeLessThan(highMin);
    }
  });
});

describe('fire support reads its reach from the sim (FIRE_SUPPORT)', () => {
  it('the strike rings 2.0 / 3.2 and the barrage round 1.0 / 1.25', () => {
    const strike = munitionForSupport('air_strike', fx.toNumber(FIRE_SUPPORT[0].splash))!;
    const barrage = munitionForSupport('mortar_barrage', fx.toNumber(FIRE_SUPPORT[1].splash))!;
    expect(strike.splash).toBe(2);
    expect(ringSpecFor(strike)!.outerK * strike.splash).toBeCloseTo(3.2, 9);
    expect(barrage.splash).toBe(1);
    expect(ringSpecFor(barrage)!.outerK * barrage.splash).toBeCloseTo(1.25, 9);
  });
});

describe('the table fails loud', () => {
  it('throws on a class it does not carry', () => {
    const t = { classes: {}, weapons: { x: 'mortar' }, support: {}, charge: {} } as unknown as MunitionsTable;
    expect(() => munitionRow('mortar', t)).toThrow(/no class "mortar"/);
  });
  it('a weapon with no reach draws no ring', () => {
    expect(ringSpecFor({ cls: 'mortar', splash: 0 })).toBeNull();
  });
});

describe('the ragdoll push per class (GH-1223)', () => {
  it('the default is today\'s constant: 1.0 m/s away, 0.4 up', () => {
    expect(RAGDOLL_PUSH_DEFAULT).toEqual({ horizontalMS: 1.0, upMS: 0.4 });
    expect(ragdollPushFor(null)).toEqual({ horizontalMS: 1.0, upMS: 0.4 });
    expect(ragdollPushForWeapon(undefined)).toEqual({ horizontalMS: 1.0, upMS: 0.4 });
    expect(ragdollPushForWeapon('rifle_556')).toEqual({ horizontalMS: 1.0, upMS: 0.4 });
    expect(ragdollPushForWeapon('')).toEqual({ horizontalMS: 1.0, upMS: 0.4 });
  });
  it('a class value reaches the push, by class and by weapon (literals)', () => {
    expect(ragdollPushFor('mortar')).toEqual({ horizontalMS: 3.0, upMS: 1.6 });
    expect(ragdollPushForWeapon('howitzer_155')).toEqual({ horizontalMS: 5.0, upMS: 2.8 });
    expect(ragdollPushForWeapon('gl_40')).toEqual({ horizontalMS: 2.0, upMS: 1.0 });
    expect(ragdollPushForWeapon('rpg')).toEqual({ horizontalMS: 3.5, upMS: 1.8 });
  });
  it('a class with no entry falls back to the default (a table with none)', () => {
    const t = { classes: { mortar: { ...munitionRow('mortar'), ragdoll_push: undefined } }, weapons: { m: 'mortar' }, support: {}, charge: {} } as unknown as MunitionsTable;
    expect(ragdollPushForWeapon('m', t)).toEqual(RAGDOLL_PUSH_DEFAULT);
  });

  it('a latched strike or charge key reads its support / charge class; a weapon id still reads the weapons table (GH-1223)', () => {
    expect(ragdollPushForKill(LATCH_AIR_STRIKE)).toEqual({ horizontalMS: 5.0, upMS: 2.8 });
    expect(ragdollPushForKill(LATCH_PLACED_CHARGE)).toEqual({ horizontalMS: 4.0, upMS: 2.2 });
    expect(ragdollPushForKill('rpg')).toEqual({ horizontalMS: 3.5, upMS: 1.8 });
    expect(ragdollPushForKill(undefined)).toEqual(RAGDOLL_PUSH_DEFAULT);
  });
  it('heavier classes push harder than the default and than the class below', () => {
    const h = (c: MunitionClassId): number => ragdollPushFor(c).horizontalMS;
    expect(h('grenade')).toBeGreaterThan(1.0);
    expect(h('mortar')).toBeGreaterThan(h('grenade'));
    expect(h('direct_he')).toBeGreaterThan(h('mortar'));
    expect(h('heavy_artillery')).toBeGreaterThan(h('direct_he'));
  });
});
