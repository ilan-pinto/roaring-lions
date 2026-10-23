import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  applyUnitRim,
  MR_MAP_ROUGHNESS_MEAN,
  reapplyUnitRim,
  RIM_PROGRAM_KEY,
  RIM_UNIFORMS,
  setUnitRimMode,
  setUnitRimRadiance,
  setUnitRimVisible,
  setUnitSurfacePass,
  SURFACE_PARAMS,
  surfaceClassOf,
  surfaceMaterialFor,
} from './unit-surface';

function fakeShader(): { uniforms: Record<string, unknown>; vertexShader: string; fragmentShader: string } {
  return {
    uniforms: {},
    vertexShader: '#include <common>\nvoid main() {}',
    fragmentShader: '#include <common>\nvoid main() {\n#include <opaque_fragment>\n}',
  };
}

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
});

describe('applyUnitRim', () => {
  it('patches the fragment, shares the uniforms and folds the key', () => {
    const m = new THREE.MeshStandardMaterial();
    applyUnitRim(m);
    const sh = fakeShader();
    m.onBeforeCompile(sh as never, {} as never);
    expect(sh.fragmentShader).toContain('uniform vec3 uRlRimColor;');
    expect(sh.fragmentShader).toContain('smoothstep( 0.0, uRlRimWidth, rlNdV )');
    expect(sh.uniforms.uRlRimColor).toBe(RIM_UNIFORMS.uRlRimColor);
    expect(m.customProgramCacheKey()).toContain(RIM_PROGRAM_KEY);
  });

  it('chains an existing hook', () => {
    const m = new THREE.MeshStandardMaterial();
    let ran = false;
    m.onBeforeCompile = () => {
      ran = true;
    };
    applyUnitRim(m);
    m.onBeforeCompile(fakeShader() as never, {} as never);
    expect(ran).toBe(true);
  });

  it('a clone gets the hook back through reapplyUnitRim', () => {
    const m = applyUnitRim(new THREE.MeshStandardMaterial());
    const c = m.clone();
    expect(c.customProgramCacheKey()).not.toContain(RIM_PROGRAM_KEY);
    reapplyUnitRim(c);
    expect(c.customProgramCacheKey()).toContain(RIM_PROGRAM_KEY);
  });

  it('the layer and the modes write the shared uniforms', () => {
    setUnitRimRadiance(1);
    setUnitRimMode('light');
    setUnitRimVisible(true);
    expect(RIM_UNIFORMS.uRlRimColor.value.r).toBeGreaterThan(0);
    setUnitRimVisible(false);
    expect(RIM_UNIFORMS.uRlRimColor.value.r).toBe(0);
    setUnitRimVisible(true);
    setUnitRimMode('dark', 0.5);
    expect(RIM_UNIFORMS.uRlRimColor.value.r).toBe(0);
    expect(RIM_UNIFORMS.uRlRimDark.value).toBe(0.5);
    setUnitRimMode('light');
  });
});
