import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  MR_MAP_ROUGHNESS_MEAN,
  setUnitSurfacePass,
  SURFACE_PARAMS,
  surfaceClassOf,
  surfaceCloneCount,
  surfaceMaterialFor,
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
});
