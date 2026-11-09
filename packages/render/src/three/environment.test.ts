/**
 * L1 (GH-943): the sky, and the registry that hands it to material classes.
 * GL-free: the PMREM bake is injected (`BakeSky`), so what is tested is the
 * bookkeeping the spec's §2 names -- per-class assignment, rebuilt only on a
 * preset change, `clone()` keeps the envMap, a non-receiving class gets none.
 * The pixels are the mock capture's (`tools/src/perf/look-l1-captures.ts`).
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  EnvironmentRegistry,
  SKY_HEIGHT,
  SKY_WIDTH,
  skyColorsFor,
  skyEquirectFloats,
  skyKeysFor,
  skyRadiance,
  type BakeSky,
  type SkyColors,
} from './environment';
import { ENV_CLASSES, ENV_USERDATA_KEY, type EnvClass } from './environment-classes';
import { paletteHex } from './palette-hex';
import { hexToLinear } from './terrain/shared';
import { TIME_OF_DAY_PRESETS } from './time-of-day';
import { surfaceMaterialFor, surfaceTableFor } from './units/unit-surface';

/** A GL-free bake: one texture per call UNLESS a previous bake is handed back, which is reused (the real one reuses its target). */
function fakeBake(log: SkyColors[]): BakeSky {
  return (_gl, colors, previous) => {
    log.push(colors);
    if (previous) return previous;
    const texture = new THREE.Texture();
    return { texture, dispose: () => texture.dispose() };
  };
}
const GL = {} as THREE.WebGLRenderer;

function mat(cls?: EnvClass): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial();
  if (cls) m.userData = { [ENV_USERDATA_KEY]: cls };
  return m;
}

describe('the sky', () => {
  it('is built from palette keys: sky overhead, the sun key at the horizon, the shared bounce below', () => {
    expect(skyKeysFor('day')).toEqual({ zenith: 'water.0', horizon: 'limestone.0', ground: 'dust.4' });
    expect(skyKeysFor('dusk')).toEqual({ zenith: 'gunmetal.1', horizon: 'dust.0', ground: 'dust.4' });
    for (const tod of ['dawn', 'day', 'dusk'] as const) {
      expect(skyKeysFor(tod).zenith).toBe(TIME_OF_DAY_PRESETS[tod].skyKey);
    }
  });

  it('is LINEAR: the zenith is hexToLinear of its palette hex, not the hex', () => {
    const c = skyColorsFor('day');
    expect(c.zenith).toEqual(hexToLinear(paletteHex('water.0')));
    // #A9C4D1 in sRGB is much darker in linear: a hex fed in raw would read ~0.66 not ~0.40 in red.
    expect(c.zenith[0]).toBeLessThan(0.45);
  });

  it('runs horizon -> zenith above the horizon and horizon -> ground below it', () => {
    const c = skyColorsFor('day');
    expect(skyRadiance(0, c)).toEqual([...c.horizon]);
    for (let i = 0; i < 3; i++) {
      expect(skyRadiance(1, c)[i]).toBeCloseTo(c.zenith[i], 12);
      expect(skyRadiance(-1, c)[i]).toBeCloseTo(c.ground[i], 12);
    }
  });

  it('has no sun disc: no texel of the sky is brighter than its brightest palette colour', () => {
    const c = skyColorsFor('day');
    const data = skyEquirectFloats(c, 64, 32);
    const ceiling = Math.max(...c.zenith, ...c.horizon, ...c.ground);
    for (let i = 0; i < data.length; i += 4) {
      expect(data[i]).toBeLessThanOrEqual(ceiling + 1e-6);
      expect(data[i + 3]).toBe(1);
    }
  });

  it('is an equirect with row 0 at the bottom and every texel of a row equal', () => {
    const c = skyColorsFor('dawn');
    const w = 16;
    const h = 8;
    const data = skyEquirectFloats(c, w, h);
    expect(data.length).toBe(w * h * 4);
    const bottom = Array.from(data.slice(0, 3));
    const top = Array.from(data.slice((h - 1) * w * 4, (h - 1) * w * 4 + 3));
    // The bottom row looks straight down (ground), the top row straight up (zenith).
    for (let i = 0; i < 3; i++) {
      expect(Math.abs(bottom[i] - c.ground[i])).toBeLessThan(Math.abs(bottom[i] - c.zenith[i]) + 1e-9);
      expect(Math.abs(top[i] - c.zenith[i])).toBeLessThan(Math.abs(top[i] - c.ground[i]) + 1e-9);
    }
    for (let i = 0; i < w; i++) expect(data[i * 4]).toBe(data[0]);
    expect(SKY_WIDTH).toBe(SKY_HEIGHT * 2);
  });

  it('differs between presets (a dusk sky is not a day sky)', () => {
    expect(skyColorsFor('dusk').zenith).not.toEqual(skyColorsFor('day').zenith);
  });
});

describe('EnvironmentRegistry', () => {
  it('gives each receiving class the one texture at that class\'s own intensity', () => {
    const reg = new EnvironmentRegistry('day', paletteHex, fakeBake([]));
    reg.attach(GL);
    const metal = mat('unitMetal');
    const skin = mat('unitDielectric');
    const wall = mat('building');
    expect(reg.adopt([metal, skin, wall], 'unitDielectric')).toBe(3);
    const tex = reg.texture;
    expect(tex).not.toBeNull();
    for (const [m, cls] of [[metal, 'unitMetal'], [skin, 'unitDielectric'], [wall, 'building']] as const) {
      expect(m.envMap, cls).toBe(tex);
      expect(m.envMapIntensity, cls).toBe(ENV_CLASSES[cls].intensity);
    }
    expect(metal.envMapIntensity).not.toBe(skin.envMapIntensity);
  });

  it('uses the template\'s fallback for an untagged material, and a tag over the fallback', () => {
    const reg = new EnvironmentRegistry('day', paletteHex, fakeBake([]));
    reg.attach(GL);
    const untagged = mat();
    const tagged = mat('unitMetal');
    reg.adopt([untagged, tagged], 'building');
    expect(untagged.envMapIntensity).toBe(ENV_CLASSES.building.intensity);
    expect(tagged.envMapIntensity).toBe(ENV_CLASSES.unitMetal.intensity);
  });

  it('never gives a non-receiving class an envMap, and STRIPS one it carries', () => {
    const reg = new EnvironmentRegistry('day', paletteHex, fakeBake([]));
    reg.attach(GL);
    for (const cls of ['ground', 'decal', 'smoke', 'fx', 'backdrop'] as const) {
      const m = mat(cls);
      m.envMap = new THREE.Texture();
      expect(reg.adopt([m], 'unitDielectric')).toBe(0);
      expect(m.envMap, cls).toBeNull();
    }
  });

  it('throws on a material tagged with a class the table does not have', () => {
    const reg = new EnvironmentRegistry('day', paletteHex, fakeBake([]));
    reg.attach(GL);
    const m = mat();
    m.userData = { [ENV_USERDATA_KEY]: 'terrain' };
    expect(() => reg.adopt([m], 'unitDielectric')).toThrow(/unknown material class "terrain"/);
  });

  it('skips a non-standard material rather than touching it', () => {
    const reg = new EnvironmentRegistry('day', paletteHex, fakeBake([]));
    reg.attach(GL);
    expect(reg.adopt([new THREE.MeshBasicMaterial()], 'unitDielectric')).toBe(0);
  });

  it('holds a material adopted BEFORE attach and hands it the texture at attach', () => {
    const reg = new EnvironmentRegistry('day', paletteHex, fakeBake([]));
    const m = mat('unitMetal');
    expect(reg.adopt([m], 'unitDielectric')).toBe(0);
    expect(m.envMap).toBeNull();
    reg.attach(GL);
    expect(m.envMap).toBe(reg.texture);
    expect(m.envMapIntensity).toBe(0.6);
  });

  it('REBUILDS ONLY ON A PRESET CHANGE, and into the same texture', () => {
    const log: SkyColors[] = [];
    const reg = new EnvironmentRegistry('day', paletteHex, fakeBake(log));
    reg.attach(GL);
    const m = mat('unitMetal');
    reg.adopt([m], 'unitDielectric');
    const tex = reg.texture;
    expect(reg.builds).toBe(1);
    expect(reg.setPreset('day')).toBe(false);
    expect(reg.builds).toBe(1);
    expect(reg.setPreset('dusk')).toBe(true);
    expect(reg.builds).toBe(2);
    expect(log[1].zenith).toEqual(skyColorsFor('dusk').zenith);
    // The identity is stable, so a clone cut before the change sees the new sky with the originals.
    expect(reg.texture).toBe(tex);
    expect(m.envMap).toBe(tex);
    expect(reg.setPreset('dusk')).toBe(false);
    expect(reg.builds).toBe(2);
  });

  it('a clone KEEPS the envMap, the intensity and the class tag (a scar, running-gear or death-fade copy)', () => {
    const reg = new EnvironmentRegistry('day', paletteHex, fakeBake([]));
    reg.attach(GL);
    const m = mat('unitMetal');
    reg.adopt([m], 'unitDielectric');
    const copy = m.clone();
    expect(copy.envMap).toBe(m.envMap);
    expect(copy.envMap).not.toBeNull();
    expect(copy.envMapIntensity).toBe(0.6);
    expect(copy.userData[ENV_USERDATA_KEY]).toBe('unitMetal');
  });

  it('a surface clone from surfaceMaterialFor is tagged with its environment class and keeps it through clone()', () => {
    const base = new THREE.MeshStandardMaterial();
    const table = surfaceTableFor(undefined, true);
    const barrel = surfaceMaterialFor(base, 'weapon', undefined, table) as THREE.MeshStandardMaterial;
    const cloth = surfaceMaterialFor(base, 'uniform', undefined, table) as THREE.MeshStandardMaterial;
    const glass = surfaceMaterialFor(base, 'hull_glass', undefined, table) as THREE.MeshStandardMaterial;
    expect(barrel.userData[ENV_USERDATA_KEY]).toBe('unitMetal');
    expect(cloth.userData[ENV_USERDATA_KEY]).toBe('unitDielectric');
    expect(glass.userData[ENV_USERDATA_KEY]).toBe('glass');
    expect(barrel.clone().userData[ENV_USERDATA_KEY]).toBe('unitMetal');
    const reg = new EnvironmentRegistry('day', paletteHex, fakeBake([]));
    reg.attach(GL);
    reg.adopt([barrel, cloth, glass], 'building');
    expect(barrel.envMapIntensity).toBe(0.6);
    expect(cloth.envMapIntensity).toBe(0.3);
    expect(glass.envMapIntensity).toBe(ENV_CLASSES.glass.intensity);
  });

  it('with the flag OFF a surface clone is exactly today\'s: no tag, and it never shares a memo slot with a tagged one', () => {
    const base = new THREE.MeshStandardMaterial();
    const plain = surfaceMaterialFor(base, 'uniform') as THREE.MeshStandardMaterial;
    expect(plain.userData).toEqual({});
    const tagged = surfaceMaterialFor(base, 'uniform', undefined, surfaceTableFor(undefined, true)) as THREE.MeshStandardMaterial;
    expect(tagged).not.toBe(plain);
    expect(tagged.userData[ENV_USERDATA_KEY]).toBe('unitDielectric');
    expect(surfaceMaterialFor(base, 'uniform')).toBe(plain);
  });

  it('the debug layer strips and restores, and reports what it wrote', () => {
    const reg = new EnvironmentRegistry('day', paletteHex, fakeBake([]));
    reg.attach(GL);
    const a = mat('unitMetal');
    const b = mat('building');
    reg.adopt([a, b], 'unitDielectric');
    expect(reg.carriers()).toBe(2);
    expect(reg.setEnabled(false)).toBe(2);
    expect(a.envMap).toBeNull();
    expect(b.envMap).toBeNull();
    expect(reg.carriers()).toBe(0);
    // A material adopted while hidden stays bare until shown.
    const late = mat('unitDielectric');
    reg.adopt([late], 'unitDielectric');
    expect(late.envMap).toBeNull();
    expect(reg.setEnabled(true)).toBe(3);
    expect(late.envMap).toBe(reg.texture);
    expect(reg.carriers()).toBe(3);
  });

  it('dispose strips every registered material (a clone memoised on a shared GLB comes back neutral) and frees the sky once', () => {
    let disposed = 0;
    const bake: BakeSky = () => {
      const texture = new THREE.Texture();
      return { texture, dispose: () => disposed++ };
    };
    const reg = new EnvironmentRegistry('day', paletteHex, bake);
    reg.attach(GL);
    const m = mat('unitMetal');
    reg.adopt([m], 'unitDielectric');
    reg.dispose();
    reg.dispose();
    expect(m.envMap).toBeNull();
    expect(disposed).toBe(1);
    expect(reg.adopt([mat('unitMetal')], 'unitDielectric')).toBe(0);
  });
});
