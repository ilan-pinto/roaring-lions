/**
 * GH-1403: the dusk figure read, the rim program's second flavour (`../dusk-read.ts`, `rain-rim.ts`, `unit-surface.ts`).
 * Oracles are LITERALS: the shipped dusk numbers are exposure 2, contrast 1, rim gain 0, power 3; the rain ones 6, 1.5, 0, 3;
 * `dust.0` is `#E0B87A` in `data/palette.json`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildMeshUnitTemplate } from './mesh-unit';
import { duskReadNow, rainReadNow, rimFlavourOf, rimUniforms, setDuskRead, setRainRead } from './rain-rim';
import {
  DUSK_SURFACE_PARAMS,
  SURFACE_PARAMS,
  WET_SURFACE_PARAMS,
  duskReadCloneCount,
  figureRimFor,
  rainRimCloneCount,
  setUnitSurfacePass,
  surfaceMaterialFor,
  surfaceTableFor,
  withMetalCap,
} from './unit-surface';

afterEach(() => {
  setUnitSurfacePass(true);
  setDuskRead({ rimGain: 0, rimPower: 3, exposure: 2, contrast: 1 });
  setRainRead({ rimGain: 0, rimPower: 3, exposure: 6, contrast: 1.5 });
});

const hasHook = (m: THREE.Material): boolean => Object.prototype.hasOwnProperty.call(m, 'onBeforeCompile');

function compile(m: THREE.Material): Record<string, { value: unknown }> {
  const shader = { uniforms: {} as Record<string, { value: unknown }>, vertexShader: '', fragmentShader: THREE.ShaderChunk.meshphysical_frag };
  m.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
  return shader.uniforms;
}

describe('the dusk table and its switch', () => {
  it('is the shipped numbers to the class, plus the switch, and no rain switch', () => {
    const { duskRead, kdfRim, ...classes } = DUSK_SURFACE_PARAMS;
    expect(duskRead).toBe(true);
    expect(kdfRim).toBeUndefined();
    const { ...shipped } = SURFACE_PARAMS;
    expect(classes).toEqual(shipped);
    expect('duskRead' in SURFACE_PARAMS).toBe(false);
  });

  it('surfaceTableFor returns it only when asked, rain wins, and off is the old table by identity', () => {
    expect(surfaceTableFor(undefined)).toBe(SURFACE_PARAMS);
    expect(surfaceTableFor(undefined, false, false)).toBe(SURFACE_PARAMS);
    expect(surfaceTableFor(undefined, true, false)).toBe(withMetalCap(SURFACE_PARAMS));
    expect(surfaceTableFor(undefined, false, true)).toBe(DUSK_SURFACE_PARAMS);
    expect(surfaceTableFor('clear', false, true)).toBe(DUSK_SURFACE_PARAMS);
    expect(surfaceTableFor('rain', false, true)).toBe(WET_SURFACE_PARAMS);
    const env = surfaceTableFor(undefined, true, true);
    expect(env).toBe(withMetalCap(DUSK_SURFACE_PARAMS));
    expect(env.duskRead).toBe(true);
    expect(env.gunmetal.metalness).toBe(0.7);
  });

  it('every faction takes the dusk flavour from it; the wet table stays KDF-only rain; the shipped table none', () => {
    for (const f of ['kdf', 'enemy', 'civilian']) {
      expect(figureRimFor(DUSK_SURFACE_PARAMS, f)).toBe('dusk');
      expect(figureRimFor(withMetalCap(DUSK_SURFACE_PARAMS), f)).toBe('dusk');
      expect(figureRimFor(SURFACE_PARAMS, f)).toBe(false);
    }
    expect(figureRimFor(WET_SURFACE_PARAMS, 'kdf')).toBe('rain');
    expect(figureRimFor(WET_SURFACE_PARAMS, 'enemy')).toBe(false);
  });
});

describe('a dusk clone', () => {
  it('is the rim program with its own flavour mark, its own memo slot, and the DUSK uniform set', () => {
    const base = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0 });
    const dusk = surfaceMaterialFor(base, 'boot', undefined, DUSK_SURFACE_PARAMS, 'dusk');
    const rain = surfaceMaterialFor(base, 'boot', undefined, WET_SURFACE_PARAMS, true);
    const dry = surfaceMaterialFor(base, 'boot');
    // `boot` (leather) is 0.7/0 on all three tables, so only the flavour in the memo key keeps them apart.
    expect(new Set([dusk, rain, dry]).size).toBe(3);
    expect(surfaceMaterialFor(base, 'boot', undefined, DUSK_SURFACE_PARAMS, 'dusk')).toBe(dusk);
    expect(hasHook(dusk)).toBe(true);
    expect(hasHook(dry)).toBe(false);
    expect(dusk.customProgramCacheKey().endsWith('|rl-unit-rain-rim')).toBe(true);
    expect(dusk.userData).toEqual({ rlRainRim: true, rlRimFlavour: 'dusk' });
    expect(rain.userData).toEqual({ rlRainRim: true });
    expect(rimFlavourOf(dusk)).toBe('dusk');
    expect(rimFlavourOf(rain)).toBe('rain');
    expect(rimFlavourOf(dry)).toBe('rain');
    const du = compile(dusk);
    const ru = compile(rain);
    expect(du.uRainExposure).toBe(rimUniforms('dusk').exposure);
    expect(ru.uRainExposure).toBe(rimUniforms('rain').exposure);
    expect(du.uRainExposure).not.toBe(ru.uRainExposure);
    expect([du.uRainExposure.value, du.uRainContrast.value, du.uRimGain.value, du.uRimPower.value]).toEqual([2, 1, 0, 3]);
    expect([ru.uRainExposure.value, ru.uRainContrast.value, ru.uRimGain.value, ru.uRimPower.value]).toEqual([6, 1.5, 0, 3]);
    expect((du.uRimColor.value as THREE.Color).getHexString()).toBe(new THREE.Color('#E0B87A').getHexString());
    for (const m of [dusk, rain, dry]) m.dispose();
  });

  it('is counted apart from a rain clone', () => {
    const d0 = duskReadCloneCount();
    const r0 = rainRimCloneCount();
    const base = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0 });
    const m = surfaceMaterialFor(base, 'uniform', undefined, DUSK_SURFACE_PARAMS, 'dusk');
    expect(duskReadCloneCount()).toBe(d0 + 1);
    expect(rainRimCloneCount()).toBe(r0);
    m.dispose();
    expect(duskReadCloneCount()).toBe(d0);
  });
});

describe('the dusk knobs', () => {
  it('setDuskRead moves the dusk set and never the rain set, and refuses out-of-range values', () => {
    setDuskRead({ rimGain: 0.4, rimPower: 2, exposure: 2.5, contrast: 1.2 });
    expect(duskReadNow()).toEqual({ rimGain: 0.4, rimPower: 2, exposure: 2.5, contrast: 1.2 });
    expect(rainReadNow()).toEqual({ rimGain: 0, rimPower: 3, exposure: 6, contrast: 1.5 });
    setRainRead({ rimGain: 0.6, rimPower: 3, exposure: 8, contrast: 1.3 });
    expect(duskReadNow()).toEqual({ rimGain: 0.4, rimPower: 2, exposure: 2.5, contrast: 1.2 });
    expect(() => setDuskRead({ rimGain: 0, rimPower: 3, exposure: 16.5, contrast: 1 })).toThrow(/dusk read: exposure/);
    expect(duskReadNow().exposure).toBe(2.5);
  });

  it('the unit-surface debug layer turns the dusk read neutral (1, 1, 0) and back', () => {
    setUnitSurfacePass(false);
    expect(duskReadNow()).toEqual({ rimGain: 0, rimPower: 3, exposure: 1, contrast: 1 });
    setUnitSurfacePass(true);
    expect(duskReadNow()).toEqual({ rimGain: 0, rimPower: 3, exposure: 2, contrast: 1 });
  });
});

describe('a figure template built with the dusk table', () => {
  function figure(): { scene: THREE.Group; animations: THREE.AnimationClip[] } {
    const scene = new THREE.Group();
    for (const role of ['uniform', 'boot', 'weapon']) {
      const mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ color: 0x336699 }));
      mesh.name = role;
      mesh.userData = { rl_role: role };
      scene.add(mesh);
    }
    return { scene, animations: [] };
  }

  it.each(['kdf', 'enemy', 'civilian'] as const)('%s: every role material is a dusk clone; on the shipped table none is', (faction) => {
    const t = buildMeshUnitTemplate(figure(), faction, 'x.glb', false, undefined, undefined, DUSK_SURFACE_PARAMS);
    expect(t.materials).toHaveLength(3);
    for (const m of t.materials) expect(rimFlavourOf(m) === 'dusk' && hasHook(m)).toBe(true);
    const plain = buildMeshUnitTemplate(figure(), faction, 'x.glb', false, undefined, undefined, SURFACE_PARAMS);
    for (const m of plain.materials) expect(hasHook(m)).toBe(false);
    for (const m of [...t.materials, ...plain.materials]) m.dispose();
  });
});
