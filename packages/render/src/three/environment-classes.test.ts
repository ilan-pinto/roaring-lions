/**
 * L1 (GH-943) gate 2: every material class is in the table, a class that is not
 * fails, and the class a unit surface maps to is a class that exists.
 */
import { describe, expect, it } from 'vitest';
import {
  ENV_CLASSES,
  ENV_CLASS_IDS,
  ENV_CLASS_OF_SURFACE,
  ENV_HEMISPHERE_INTENSITY,
  ENV_HEMISPHERE_START,
  ENV_METAL_CAP,
  SHIPPED_METAL_CAP,
  envClassOfDecorMesh,
  envSpecFor,
  isEnvClass,
} from './environment-classes';
import { SURFACE_PARAMS } from './units/unit-surface';
import { TIME_OF_DAY_PRESETS } from './time-of-day';

describe('the environment class table', () => {
  it('lists every class, each with a spec (a class missing from the table fails here)', () => {
    expect(Object.keys(ENV_CLASSES).sort()).toEqual([...ENV_CLASS_IDS].sort());
    for (const id of ENV_CLASS_IDS) expect(() => envSpecFor(id), id).not.toThrow();
  });

  it('throws on a class it does not know, naming the known set', () => {
    expect(() => envSpecFor('terrain')).toThrow(/unknown material class "terrain"/);
    expect(() => envSpecFor('terrain')).toThrow(/unitMetal/);
    expect(isEnvClass('ground')).toBe(true);
    expect(isEnvClass('terrain')).toBe(false);
  });

  it('holds the lead-approved starting values (1 Nov, GH-943): metal 0.6, dielectric 0.3, buildings 0.2', () => {
    expect(ENV_CLASSES.unitMetal).toEqual({ receives: true, intensity: 0.6 });
    expect(ENV_CLASSES.unitDielectric).toEqual({ receives: true, intensity: 0.3 });
    expect(ENV_CLASSES.building).toEqual({ receives: true, intensity: 0.2 });
  });

  it('gives the ground, decals, smoke, FX and the backdrop NO environment: an exact zero, not a small number', () => {
    for (const id of ['ground', 'decal', 'smoke', 'fx', 'backdrop'] as const) {
      expect(ENV_CLASSES[id], id).toEqual({ receives: false, intensity: 0 });
    }
  });

  it('a class that does not receive never carries an intensity (the pair cannot disagree)', () => {
    for (const id of ENV_CLASS_IDS) {
      const s = envSpecFor(id);
      if (!s.receives) expect(s.intensity, id).toBe(0);
      else expect(s.intensity, id).toBeGreaterThan(0);
    }
  });

  it('maps every unit surface class to a class that exists, and only gunmetal to metal', () => {
    for (const cls of Object.keys(SURFACE_PARAMS)) {
      const env = ENV_CLASS_OF_SURFACE[cls as keyof typeof ENV_CLASS_OF_SURFACE];
      expect(isEnvClass(env), cls).toBe(true);
    }
    expect(Object.keys(ENV_CLASS_OF_SURFACE).sort()).toEqual(Object.keys(SURFACE_PARAMS).sort());
    const metals = Object.entries(ENV_CLASS_OF_SURFACE).filter(([, v]) => v === 'unitMetal').map(([k]) => k);
    expect(metals).toEqual(['gunmetal']);
  });

  it('keeps the metal cap pair: 0.45 shipped, 0.7 with an environment', () => {
    expect(SHIPPED_METAL_CAP).toBe(0.45);
    expect(SURFACE_PARAMS.gunmetal.metalness).toBe(SHIPPED_METAL_CAP);
    expect(ENV_METAL_CAP).toBe(0.7);
  });

  it('lowers the hemisphere on every preset (the environment supplies the rest), never raising it', () => {
    for (const tod of ['dawn', 'day', 'dusk'] as const) {
      expect(ENV_HEMISPHERE_INTENSITY[tod], tod).toBeLessThanOrEqual(TIME_OF_DAY_PRESETS[tod].hemiIntensity);
      expect(ENV_HEMISPHERE_INTENSITY[tod], tod).toBeGreaterThan(0);
      // The census-solved value never sits below the approved starting point: the ground gets no environment, so it cannot need less.
      expect(ENV_HEMISPHERE_INTENSITY[tod], tod).toBeGreaterThanOrEqual(ENV_HEMISPHERE_START[tod]);
    }
    expect(ENV_HEMISPHERE_START).toEqual({ dawn: 0.5, day: 0.6, dusk: 0.47 });
  });

  it('ground litter (decor-sand) is the ground\'s class and every other decor batch is a prop', () => {
    expect(envClassOfDecorMesh('decor-sand')).toBe('ground');
    expect(envSpecFor(envClassOfDecorMesh('decor-sand')).receives).toBe(false);
    for (const n of ['decor-foliage', 'decor-trunk', 'decor-rock']) expect(envClassOfDecorMesh(n), n).toBe('prop');
  });
});
