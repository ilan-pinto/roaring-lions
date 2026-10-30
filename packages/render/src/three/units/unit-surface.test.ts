import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  MR_MAP_ROUGHNESS_MEAN,
  setUnitSurfacePass,
  SURFACE_PARAMS,
  surfaceClassOf,
  surfaceCloneCount,
  surfaceMaterialFor,
  surfaceTableFor,
  WET_SURFACE_PARAMS,
} from './unit-surface';

describe('surfaceClassOf', () => {
  it('maps team roles and vehicle node suffixes', () => {
    expect(surfaceClassOf('uniform')).toBe('cloth');
    expect(surfaceClassOf('weapon')).toBe('gunmetal');
    expect(surfaceClassOf('hull_rubber')).toBe('rubber');
    expect(surfaceClassOf('turret_metal')).toBe('gunmetal');
    expect(surfaceClassOf('hull_hull')).toBe('armour');
    expect(surfaceClassOf('frame_cut')).toBeNull();
  });
});

describe('surfaceMaterialFor', () => {
  it('clones once per class, writes the class params, and the toggle restores today', () => {
    const base = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0 });
    const a = surfaceMaterialFor(base, 'weapon') as THREE.MeshStandardMaterial;
    expect(a).not.toBe(base);
    expect(surfaceMaterialFor(base, 'metal')).toBe(a);
    expect(a.roughness).toBe(SURFACE_PARAMS.gunmetal.roughness);
    expect(a.metalness).toBe(SURFACE_PARAMS.gunmetal.metalness);
    setUnitSurfacePass(false);
    expect(a.roughness).toBe(0.85);
    expect(a.metalness).toBe(0);
    setUnitSurfacePass(true);
    expect(a.roughness).toBe(SURFACE_PARAMS.gunmetal.roughness);
  });

  it('rescales an MR map onto the target and drops it for metalness on a metal class', () => {
    const tex = new THREE.Texture();
    const base = new THREE.MeshStandardMaterial({ roughnessMap: tex, metalnessMap: tex, roughness: 1, metalness: 1 });
    const metal = surfaceMaterialFor(base, 'turret_metal') as THREE.MeshStandardMaterial;
    expect(metal.roughness).toBeCloseTo(SURFACE_PARAMS.gunmetal.roughness / MR_MAP_ROUGHNESS_MEAN, 6);
    expect(metal.metalnessMap).toBeNull();
    const rubber = surfaceMaterialFor(base, 'hull_rubber') as THREE.MeshStandardMaterial;
    expect(rubber.metalnessMap).toBe(tex);
  });

  it('leaves an unclassified role on the base material', () => {
    const base = new THREE.MeshStandardMaterial();
    expect(surfaceMaterialFor(base, 'frame_cut')).toBe(base);
  });

  it('different classes of one base are different clones, each with its own params', () => {
    const base = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0 });
    const cloth = surfaceMaterialFor(base, 'uniform') as THREE.MeshStandardMaterial;
    const gun = surfaceMaterialFor(base, 'weapon') as THREE.MeshStandardMaterial;
    expect(cloth).not.toBe(gun);
    expect(cloth.roughness).toBe(SURFACE_PARAMS.cloth.roughness);
    expect(gun.metalness).toBeLessThanOrEqual(0.45);
  });

  it('a disposed clone leaves the registry and is not handed out again', () => {
    const base = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0 });
    const before = surfaceCloneCount();
    const a = surfaceMaterialFor(base, 'boot') as THREE.MeshStandardMaterial;
    expect(surfaceCloneCount()).toBe(before + 1);
    a.dispose();
    expect(surfaceCloneCount()).toBe(before);
    // The toggle no longer touches it.
    setUnitSurfacePass(false);
    expect(a.roughness).toBe(SURFACE_PARAMS.leather.roughness);
    setUnitSurfacePass(true);
    // The memo forgot it: the next ask is a fresh, live clone.
    const b = surfaceMaterialFor(base, 'boot');
    expect(b).not.toBe(a);
    expect(surfaceCloneCount()).toBe(before + 1);
  });

  it('GH-705 leak: a class handed to several role nodes leaves tracking on the template\'s ONE dispose', () => {
    // A template lists each material once and disposes it once
    // (`disposeMeshUnitTemplate`, `disposeVehicleMeshTemplate`), however many
    // role nodes draw with it. The first cut counted one hand-out per NODE, so
    // a clone shared by three nodes was never dropped, and the module held every
    // mission's materials -- and through them its textures and renderer -- after
    // the mission was left (the CI memory walk).
    const base = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0 });
    const before = surfaceCloneCount();
    const a = surfaceMaterialFor(base, 'hull_hull');
    expect(surfaceMaterialFor(base, 'turret_hull')).toBe(a);
    expect(surfaceMaterialFor(base, 'medevac_hull')).toBe(a);
    expect(surfaceCloneCount()).toBe(before + 1);
    a.dispose();
    expect(surfaceCloneCount()).toBe(before);
  });

  it('a clone a later template is handed again is tracked again', () => {
    const base = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0 });
    const before = surfaceCloneCount();
    const a = surfaceMaterialFor(base, 'face');
    a.dispose();
    expect(surfaceCloneCount()).toBe(before);
    const b = surfaceMaterialFor(base, 'face');
    expect(surfaceCloneCount()).toBe(before + 1);
    b.dispose();
    expect(surfaceCloneCount()).toBe(before);
  });
});

describe('the wet surface table (GH-871 P4 T5)', () => {
  // Oracles are LITERALS: the brief's numbers, not read back from the table.
  it('carries the four wet roughnesses, and every other class and every metalness as shipped', () => {
    expect(WET_SURFACE_PARAMS).toEqual({
      cloth: { roughness: 0.8, metalness: 0 },
      leather: { roughness: 0.7, metalness: 0 },
      skin: { roughness: 0.6, metalness: 0 },
      wood: { roughness: 0.8, metalness: 0 },
      gear: { roughness: 0.8, metalness: 0 },
      gunmetal: { roughness: 0.32, metalness: 0.45 },
      armour: { roughness: 0.52, metalness: 0 },
      plate: { roughness: 0.48, metalness: 0.1 },
      rubber: { roughness: 0.96, metalness: 0 },
      glass: { roughness: 0.2, metalness: 0 },
    });
  });

  it('keeps the 0.45 metalness cap (no environment map)', () => {
    for (const p of Object.values(WET_SURFACE_PARAMS)) expect(p.metalness).toBeLessThanOrEqual(0.45);
  });

  it('is the shipped table, unchanged, for a dry renderer', () => {
    expect(SURFACE_PARAMS.cloth.roughness).toBe(0.92);
    expect(SURFACE_PARAMS.armour.roughness).toBe(0.78);
    expect(SURFACE_PARAMS.plate.roughness).toBe(0.7);
    expect(SURFACE_PARAMS.gunmetal.roughness).toBe(0.42);
    expect(surfaceTableFor(undefined)).toBe(SURFACE_PARAMS);
    expect(surfaceTableFor('clear')).toBe(SURFACE_PARAMS);
    expect(surfaceTableFor('rain')).toBe(WET_SURFACE_PARAMS);
  });

  it('a clone takes the table it was asked for, and the cache key includes the table', () => {
    const base = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0 });
    const wet = surfaceMaterialFor(base, 'uniform', undefined, WET_SURFACE_PARAMS) as THREE.MeshStandardMaterial;
    const dry = surfaceMaterialFor(base, 'uniform') as THREE.MeshStandardMaterial;
    // One base, two renderers: the second must not come back wearing the first's roughness.
    expect(wet).not.toBe(dry);
    expect(wet.roughness).toBe(0.8);
    expect(dry.roughness).toBe(0.92);
    // And each memoises on its own key.
    expect(surfaceMaterialFor(base, 'keffiyeh', undefined, WET_SURFACE_PARAMS)).toBe(wet);
    expect(surfaceMaterialFor(base, 'keffiyeh')).toBe(dry);
    expect(wet.metalness).toBe(0);
  });

  it('writes the wet metal class (0.32 / 0.45) and rescales an MR map onto the wet roughness', () => {
    const tex = new THREE.Texture();
    const base = new THREE.MeshStandardMaterial({ roughnessMap: tex, metalnessMap: tex, roughness: 1, metalness: 1 });
    const gun = surfaceMaterialFor(base, 'weapon', undefined, WET_SURFACE_PARAMS) as THREE.MeshStandardMaterial;
    expect(gun.metalness).toBe(0.45);
    expect(gun.metalnessMap).toBeNull();
    // factor = target / the map's own mean (0.797): 0.32 / 0.797.
    expect(gun.roughness).toBeCloseTo(0.4015056, 6);
    const hull = surfaceMaterialFor(base, 'hull_hull', undefined, WET_SURFACE_PARAMS) as THREE.MeshStandardMaterial;
    expect(hull.roughness).toBeCloseTo(0.6524468, 6);
  });
});
