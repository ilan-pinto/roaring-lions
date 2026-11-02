/**
 * L3 (GH-943): the team-colour mask and the authored maps, at the material level.
 *
 * Oracles are LITERALS: team.own is `#2F6FD9` (linear 0.0284, 0.1590, 0.6939), team.hostile `#D93A2B`;
 * the strength 0.85 is the lead's ruling of 2 Nov; the dry/wet armour roughness ratio is 0.52 / 0.78.
 * Programs are compiled from three's own meshphysical sources (`ShaderChunk`), never a hand-written stand-in.
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { isAuthoredMaterial, resetAuthoredRegistry, setNormalMapsPass } from './authored-maps';
import {
  TEAM_MASK_PROGRAM_KEY,
  TEAM_MASK_STRENGTH,
  TeamMaskSlots,
  VehicleTeamMaterials,
  carryAuthored,
  setTeamMaskPass,
  teamHookOf,
} from './team-mask';
import { runningGearMaterial } from './running-gear-material';
import { VehicleScarMaterials } from './vehicle-damage';
import { SURFACE_PARAMS, WET_SURFACE_PARAMS, surfaceMaterialFor, surfaceTableFor, withMetalCap } from './unit-surface';
import { charredTexturedMaterial, texturedMaterial } from '../world-materials';

afterEach(() => {
  setTeamMaskPass(true);
  resetAuthoredRegistry();
});

const tex = (): THREE.DataTexture => new THREE.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1);

/** What `GLTFLoader` hands over for the Lavi after the maps pass: a bake, a normal map, one ORM map in three slots. */
function lavi(opts: { luma?: number; authored?: boolean } = {}): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ map: tex() });
  m.map!.colorSpace = THREE.SRGBColorSpace;
  const orm = tex();
  m.normalMap = tex();
  m.normalScale.set(1, -1); // GLTFLoader, no tangents
  m.roughnessMap = orm;
  m.metalnessMap = orm;
  m.aoMap = orm;
  m.userData = { rl_bake_luma: 0.09, ...(opts.authored === false ? {} : { rl_orm: true }), ...(opts.luma === undefined ? { rl_team_luma: 0.16 } : { rl_team_luma: opts.luma }) };
  return m;
}

function compile(m: THREE.Material): { vertexShader: string; fragmentShader: string; uniforms: Record<string, { value: unknown }> } {
  const shader = {
    uniforms: {} as Record<string, { value: unknown }>,
    vertexShader: THREE.ShaderChunk.meshphysical_vert,
    fragmentShader: THREE.ShaderChunk.meshphysical_frag,
  };
  m.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
  return shader;
}

const slotsOf = (): TeamMaskSlots => new TeamMaskSlots(['#2F6FD9', '#D93A2B', '#F2E8D5']);
const hasHook = (m: THREE.Material): boolean => Object.prototype.hasOwnProperty.call(m, 'onBeforeCompile');

describe('the team slots', () => {
  it('hold LINEAR colours: #2F6FD9 is (0.0284, 0.1590, 0.6939), and a write moves every reader', () => {
    const s = slotsOf();
    const [r, g, b] = s.colors[0]!.value.toArray();
    expect(r).toBeCloseTo(0.0284, 3);
    expect(g).toBeCloseTo(0.159, 3);
    expect(b).toBeCloseTo(0.6939, 3);
    s.set(['#D93A2B', '#D93A2B', '#D93A2B']);
    expect(s.colors[0]!.value.x).toBeCloseTo(0.6939, 3);
    expect(() => new TeamMaskSlots(['#fff'])).toThrow(/need 3/);
  });
});

describe('the variants', () => {
  it('one per (base x slot), memoised, and a base with no mask is returned as it is', () => {
    const team = new VehicleTeamMaterials(slotsOf());
    const base = lavi();
    const a0 = team.materialFor(base, 0);
    const a1 = team.materialFor(base, 1);
    expect(a0).not.toBe(base);
    expect(a0).not.toBe(a1);
    expect(team.materialFor(base, 0)).toBe(a0);
    expect(team.size).toBe(2);
    expect(team.materialFor(lavi({ authored: false }), 0)).toBeInstanceOf(THREE.MeshStandardMaterial);
    const plain = lavi({ authored: false });
    expect(team.materialFor(plain, 0)).toBe(plain);
    expect(() => team.materialFor(base, 3)).toThrow(/colour slot 3/);
  });

  it('share the template\'s textures by reference (+0 uploads)', () => {
    const base = lavi();
    const v = new VehicleTeamMaterials(slotsOf()).materialFor(base, 2) as THREE.MeshStandardMaterial;
    expect(v.map).toBe(base.map);
    expect(v.normalMap).toBe(base.normalMap);
    expect(v.roughnessMap).toBe(base.roughnessMap);
  });

  it('compile with the hook at color_fragment, after map_fragment and before lighting, reading the ORM alpha', () => {
    const v = new VehicleTeamMaterials(slotsOf()).materialFor(lavi(), 0);
    const { fragmentShader, uniforms } = compile(v);
    const at = (s: string): number => fragmentShader.indexOf(s);
    expect(fragmentShader).toContain('texture2D( roughnessMap, vRoughnessMapUv ).a');
    expect(at('uTeamStrength * ( 1.0 - texture2D')).toBeGreaterThan(at('#include <map_fragment>'));
    expect(at('uTeamStrength * ( 1.0 - texture2D')).toBeLessThan(at('#include <roughnessmap_fragment>'));
    expect(fragmentShader).toContain('uniform vec3 uTeamColor;');
    expect((uniforms.uTeamStrength as { value: number }).value).toBe(0.85);
    expect(TEAM_MASK_STRENGTH).toBe(0.85);
    expect(v.customProgramCacheKey()).toContain(TEAM_MASK_PROGRAM_KEY);
  });

  it('variants of a slot share ONE colour uniform; slots differ; luma rides per material', () => {
    const team = new VehicleTeamMaterials(slotsOf());
    const a = team.materialFor(lavi({ luma: 0.16 }), 0);
    const b = team.materialFor(lavi({ luma: 0.2 }), 0);
    const c = team.materialFor(lavi(), 1);
    expect(compile(a).uniforms.uTeamColor).toBe(compile(b).uniforms.uTeamColor);
    expect(compile(a).uniforms.uTeamColor).not.toBe(compile(c).uniforms.uTeamColor);
    expect((compile(a).uniforms.uTeamLuma as { value: number }).value).toBe(0.16);
    expect((compile(b).uniforms.uTeamLuma as { value: number }).value).toBe(0.2);
  });

  it('the `team-mask` layer zeroes the shared strength and puts it back', () => {
    const v = new VehicleTeamMaterials(slotsOf()).materialFor(lavi(), 0);
    const strength = compile(v).uniforms.uTeamStrength as { value: number };
    expect(setTeamMaskPass(false)).toBeGreaterThanOrEqual(1);
    expect(strength.value).toBe(0);
    setTeamMaskPass(true);
    expect(strength.value).toBe(0.85);
  });
});

describe('clones keep the mask, and a wreck has none', () => {
  it('a scar clone is re-hooked (Material.clone drops onBeforeCompile) and its key names the hook', () => {
    const team = new VehicleTeamMaterials(slotsOf());
    const variant = team.materialFor(lavi(), 0) as THREE.MeshStandardMaterial;
    const scar = new VehicleScarMaterials().materialFor(variant, 3) as THREE.MeshStandardMaterial;
    expect(scar).not.toBe(variant);
    expect(teamHookOf(scar)).toBe(teamHookOf(variant));
    expect(scar.customProgramCacheKey()).toContain(TEAM_MASK_PROGRAM_KEY);
    const { fragmentShader, uniforms } = compile(scar);
    expect(fragmentShader).toContain('uTeamStrength');
    expect(uniforms.uTeamColor).toBe(compile(variant).uniforms.uTeamColor);
  });

  it('a running-gear clone compiles BOTH the tread and the mask, tread first, one program key', () => {
    const variant = new VehicleTeamMaterials(slotsOf()).materialFor(lavi(), 0);
    const spec = { wheels: [], track: { r: [10, 0.3], l: [10, 0.3] }, gauge: { r: 1.2, l: 1.2 }, wheelbase: 0, steerLimit: 0 } as never;
    const { material } = runningGearMaterial(variant, spec);
    const { fragmentShader, vertexShader } = compile(material);
    expect(vertexShader).toContain('rgApply');
    expect(fragmentShader).toContain('rgBarIntegral');
    expect(fragmentShader).toContain('uTeamStrength');
    expect(fragmentShader.indexOf('rgOnTrack')).toBeLessThan(fragmentShader.indexOf('uTeamStrength * ( 1.0 - texture2D'));
    const key = material.customProgramCacheKey();
    expect(key.split(TEAM_MASK_PROGRAM_KEY)).toHaveLength(2); // named once, not twice
    expect(key).toContain('rl-running-gear');
  });

  it('a clone of an UNMASKED authored material gets no hook and no key', () => {
    const base = lavi();
    const scar = base.clone();
    carryAuthored(scar, base);
    expect(hasHook(scar)).toBe(false);
    expect(scar.customProgramCacheKey()).not.toContain(TEAM_MASK_PROGRAM_KEY);
  });

  it('the soot wreck is hook-free, drops the roughness and metal maps, keeps the normal map', () => {
    const base = texturedMaterial(lavi());
    const wreck = charredTexturedMaterial(base);
    expect(teamHookOf(wreck)).toBeUndefined();
    const { fragmentShader } = compile(wreck);
    expect(fragmentShader).not.toContain('uTeamColor');
    expect(wreck.roughness).toBe(1);
    expect(wreck.metalness).toBe(0);
    expect(wreck.roughnessMap).toBeNull();
    expect(wreck.metalnessMap).toBeNull();
    expect(wreck.normalMap).toBe(base.normalMap);
    expect(base.roughnessMap).not.toBeNull(); // the live twin keeps its maps
  });
});

describe('the authored branch of texturedMaterial and the surface pass', () => {
  it('keeps both maps, roughness 1, metal at the shipped cap, and pins the data maps NoColorSpace at anisotropy 8', () => {
    const m = texturedMaterial(lavi());
    expect(isAuthoredMaterial(m)).toBe(true);
    expect([m.roughness, m.metalness]).toEqual([1, 0.45]);
    expect(m.map!.colorSpace).toBe(THREE.SRGBColorSpace);
    for (const t of [m.normalMap!, m.roughnessMap!, m.metalnessMap!, m.aoMap!]) {
      expect(t.colorSpace).toBe(THREE.NoColorSpace);
      expect(t.anisotropy).toBe(8);
    }
  });

  it('a mis-tagged sRGB normal map is put back to NoColorSpace', () => {
    const base = lavi();
    base.normalMap!.colorSpace = THREE.SRGBColorSpace;
    expect(texturedMaterial(base).normalMap!.colorSpace).toBe(THREE.NoColorSpace);
  });

  it('every class draws the map\'s roughness (factor 1) and the table\'s metal cap, metal map never dropped', () => {
    const base = texturedMaterial(lavi());
    for (const role of ['hull_hull', 'hull_rubber', 'turret_metal']) {
      const dry = surfaceMaterialFor(base, role, undefined, SURFACE_PARAMS) as THREE.MeshStandardMaterial;
      expect([dry.roughness, dry.metalness]).toEqual([1, 0.45]);
      expect(dry.metalnessMap).toBe(base.metalnessMap);
    }
    const env = surfaceTableFor('clear', true);
    expect(env).toBe(withMetalCap(SURFACE_PARAMS));
    const hot = surfaceMaterialFor(base, 'turret_metal', undefined, env) as THREE.MeshStandardMaterial;
    expect(hot.metalness).toBe(0.7);
  });

  it('rain scales roughness by 0.52 / 0.78 and nothing else', () => {
    const base = texturedMaterial(lavi());
    const wet = surfaceMaterialFor(base, 'hull_hull', undefined, WET_SURFACE_PARAMS) as THREE.MeshStandardMaterial;
    expect(wet.roughness).toBeCloseTo(0.52 / 0.78, 6);
    expect(wet.metalness).toBe(0.45);
  });

  it('a surface clone is not itself hooked: the team variant is cut from it, per colour slot', () => {
    const base = texturedMaterial(lavi());
    const clone = surfaceMaterialFor(base, 'hull_hull', undefined, SURFACE_PARAMS);
    expect(teamHookOf(clone)).toBeUndefined();
    expect(teamHookOf(new VehicleTeamMaterials(slotsOf()).materialFor(clone, 0))).toBeDefined();
  });
});

describe('the `normal-maps` layer', () => {
  it('drops the normal map on every registered material and restores it', () => {
    const base = texturedMaterial(lavi());
    const v = new VehicleTeamMaterials(slotsOf()).materialFor(surfaceMaterialFor(base, 'hull_hull'), 0) as THREE.MeshStandardMaterial;
    const n = v.normalMap;
    expect(n).not.toBeNull();
    expect(setNormalMapsPass(false)).toBeGreaterThanOrEqual(2);
    expect(v.normalMap).toBeNull();
    // a material made while the layer is off starts without its normal map
    const late = new VehicleTeamMaterials(slotsOf()).materialFor(surfaceMaterialFor(base, 'turret_metal'), 1) as THREE.MeshStandardMaterial;
    expect(late.normalMap).toBeNull();
    setNormalMapsPass(true);
    expect(v.normalMap).toBe(n);
    expect(late.normalMap).toBe(n);
  });
});

describe('what the generator and the loader agree on', () => {
  it('GLTFLoader still negates normalScale.y when there are no tangents (the frame the maps are written in)', () => {
    const req = createRequire(import.meta.url);
    const src = readFileSync(req.resolve('three/addons/loaders/GLTFLoader.js'), 'utf8');
    expect(src).toMatch(/if \( cachedMaterial\.normalScale \) cachedMaterial\.normalScale\.y \*= - 1;/);
  });

  it('both texture decoders keep the ORM alpha: premultiplyAlpha is "none"', () => {
    const src = readFileSync(new URL('./gltf-loader.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/premultiplyAlpha: 'none'/);
    // three's own bitmap loader, which the hot path uses, passes the same
    const req = createRequire(import.meta.url);
    expect(readFileSync(req.resolve('three/src/loaders/ImageBitmapLoader.js'), 'utf8')).toMatch(/premultiplyAlpha: 'none'/);
  });
});
