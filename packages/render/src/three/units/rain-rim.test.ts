/**
 * The rain rim on KDF figures (GH-871 P4 PR 914, the lead's ruling 1, replacing the flat S-L2 lift):
 * which template builds carry it, what the compiled fragment source is, and what shares what.
 *
 * The pure half (the clone, its cache key, the debug toggle) is in `unit-surface.test.ts`; the
 * calibration model is `tools/src/wet-unit-rim.test.ts`. Oracles here are LITERALS: overcast.1 is
 * `#9FA9B5`, linear (0.34670, 0.39676, 0.46207); the shipped provisional gain 0.4; the power 3.
 */
import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildMeshUnitTemplate } from './mesh-unit';
import { buildVehicleMeshTemplate } from './mesh-vehicle';
import { SURFACE_PARAMS, WET_SURFACE_PARAMS, setUnitSurfacePass, surfaceTableFor } from './unit-surface';
import { liftWoundedTemplate } from './wounded-read';
import { patchRainRim, rimUniforms, setRainRimGain } from './rain-rim';

/** The rim line, as a literal (not read from the module). */
const RIM_LINE =
  'totalEmissiveRadiance += uRimColor * uRimGain * pow( 1.0 - saturate( dot( normalize( normal ), normalize( vViewPosition ) ) ), uRimPower );';
const RIM_DECL = 'uniform vec3 uRimColor;\nuniform float uRimGain;\nuniform float uRimPower;';

afterEach(() => {
  setUnitSurfacePass(true);
  setRainRimGain(0.4);
});

/** A `GLTFLoader`-shaped result, one mesh per part (the `textured-infantry.test.ts` shape). */
function sceneOf(parts: { role: string; map?: THREE.Texture; name?: string }[]): {
  scene: THREE.Group;
  animations: THREE.AnimationClip[];
} {
  const scene = new THREE.Group();
  for (const part of parts) {
    const material = new THREE.MeshStandardMaterial({ color: 0x336699 });
    if (part.map) material.map = part.map;
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
    mesh.name = part.name ?? part.role;
    mesh.userData = { rl_role: part.role };
    scene.add(mesh);
  }
  return { scene, animations: [] };
}

const hasRim = (m: THREE.Material): boolean => Object.prototype.hasOwnProperty.call(m, 'onBeforeCompile');
const emissiveOf = (m: THREE.Material): number[] => (m as THREE.MeshStandardMaterial).emissive.toArray();
const PARTS = [{ role: 'uniform' }, { role: 'boot' }, { role: 'weapon' }, { role: 'webbing' }];

/** What the program would be compiled from: three's own meshphysical fragment, then the material's hook. */
function compile(m: THREE.Material): { fragmentShader: string; uniforms: Record<string, { value: unknown }> } {
  const shader = { uniforms: {} as Record<string, { value: unknown }>, vertexShader: '', fragmentShader: THREE.ShaderChunk.meshphysical_frag };
  m.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
  return { fragmentShader: shader.fragmentShader, uniforms: shader.uniforms };
}

describe('which template builds carry the rain rim', () => {
  it('a KDF figure on the wet table: every classified role material is a rim variant, none is lifted', () => {
    const t = buildMeshUnitTemplate(sceneOf(PARTS), 'kdf', 'x.glb', false, undefined, undefined, WET_SURFACE_PARAMS);
    expect(t.materials).toHaveLength(4);
    for (const m of t.materials) {
      expect(hasRim(m)).toBe(true);
      expect(m.userData).toEqual({ rlRainRim: true });
      // The flat lift is gone: the emissive is the base`s own (black).
      expect(emissiveOf(m)).toEqual([0, 0, 0]);
    }
  });

  it('a KDF figure with a baked texture (the Meshy camouflage path) takes it too, and the loader`s own material stays plain', () => {
    const map = new THREE.Texture();
    const gltf = sceneOf([{ role: 'uniform', map }, { role: 'boot', map }, { role: 'weapon' }]);
    const loadedMaterials: THREE.Material[] = [];
    gltf.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && (m.material as THREE.MeshStandardMaterial).map) loadedMaterials.push(m.material as THREE.Material);
    });
    expect(loadedMaterials).toHaveLength(2);
    const t = buildMeshUnitTemplate(gltf, 'kdf', 'inf_squad.glb', true, undefined, undefined, WET_SURFACE_PARAMS);
    // Two loader bases, their two role clones, and the weapon's ramp material.
    expect(t.materials).toHaveLength(5);
    const rimmed = t.materials.filter((m) => !loadedMaterials.includes(m));
    expect(rimmed).toHaveLength(3);
    for (const m of rimmed) expect(hasRim(m)).toBe(true);
    expect(rimmed.filter((m) => (m as THREE.MeshStandardMaterial).map === map)).toHaveLength(2);
    for (const m of loadedMaterials) expect(hasRim(m)).toBe(false);
  });

  it('an enemy and a civilian figure on the wet table are NOT rimmed (the ruling is KDF infantry)', () => {
    for (const faction of ['enemy', 'civilian'] as const) {
      const t = buildMeshUnitTemplate(sceneOf(PARTS), faction, 'x.glb', false, undefined, undefined, WET_SURFACE_PARAMS);
      for (const m of t.materials) {
        expect(hasRim(m)).toBe(false);
        expect(m.userData).toEqual({});
      }
      // ...but they DO take the wet roughness: the table reached them.
      expect((t.materials[0] as THREE.MeshStandardMaterial).roughness).toBe(0.8);
    }
  });

  it('a KDF figure on the shipped table, or the default, or surfaceTableFor(clear), is built exactly as today', () => {
    for (const table of [undefined, SURFACE_PARAMS, surfaceTableFor('clear'), surfaceTableFor(undefined)]) {
      const t = buildMeshUnitTemplate(sceneOf(PARTS), 'kdf', 'x.glb', false, undefined, undefined, table);
      for (const m of t.materials) {
        const std = m as THREE.MeshStandardMaterial;
        expect(hasRim(std)).toBe(false);
        expect(emissiveOf(std)).toEqual([0, 0, 0]);
        expect(std.emissiveIntensity).toBe(1);
        expect(std.emissiveMap).toBeNull();
        expect(std.userData).toEqual({});
        // Compiling it changes nothing: the dry source is three's own.
        expect(compile(std).fragmentShader).toBe(THREE.ShaderChunk.meshphysical_frag);
      }
      const byRole = new Map(t.materials.map((m, i) => [PARTS[i].role, m as THREE.MeshStandardMaterial]));
      // today's literals: cloth 0.92, leather 0.7, gunmetal 0.42 / 0.45, gear 0.8
      expect(byRole.get('uniform')!.roughness).toBe(0.92);
      expect(byRole.get('boot')!.roughness).toBe(0.7);
      expect(byRole.get('weapon')!.roughness).toBe(0.42);
      expect(byRole.get('weapon')!.metalness).toBe(0.45);
      expect(byRole.get('webbing')!.roughness).toBe(0.8);
    }
  });

  it('a vehicle on the wet table is NOT rimmed (it takes the wet roughness only)', () => {
    const gltf = sceneOf([
      { role: 'hull', name: 'hull_hull' },
      { role: 'metal', name: 'turret_metal' },
    ]);
    const t = buildVehicleMeshTemplate(gltf, 'mbt_lavi', false, undefined, WET_SURFACE_PARAMS);
    expect(t.materials.length).toBeGreaterThan(0);
    for (const m of t.materials) {
      expect(hasRim(m)).toBe(false);
      expect(emissiveOf(m)).toEqual([0, 0, 0]);
    }
    expect(
      t.materials.some((m) => (m as THREE.MeshStandardMaterial).roughness === 0.52),
      'the wet armour roughness reached the hull'
    ).toBe(true);
  });
});

describe('the compiled fragment source', () => {
  it('three`s meshphysical fragment has the chunks the patch relies on, in the order it relies on', () => {
    const src = THREE.ShaderChunk.meshphysical_frag;
    expect(src).toContain('varying vec3 vViewPosition;');
    const normalAt = src.indexOf('#include <normal_fragment_begin>');
    const emissiveAt = src.indexOf('#include <emissivemap_fragment>');
    const outgoingAt = src.indexOf('vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;');
    expect(normalAt).toBeGreaterThan(0);
    expect(emissiveAt).toBeGreaterThan(normalAt);
    expect(outgoingAt).toBeGreaterThan(emissiveAt);
  });

  it('the wet KDF variant carries the rim lines; strip them and it equals the dry source', () => {
    const t = buildMeshUnitTemplate(sceneOf(PARTS), 'kdf', 'x.glb', false, undefined, undefined, WET_SURFACE_PARAMS);
    const dry = THREE.ShaderChunk.meshphysical_frag;
    for (const m of t.materials) {
      const wet = compile(m).fragmentShader;
      expect(wet).not.toBe(dry);
      expect(wet).toContain(RIM_LINE);
      expect(wet).toContain(RIM_DECL);
      expect(wet.replace(`\n${RIM_DECL}`, '').replace(`\n${RIM_LINE}`, '')).toBe(dry);
      // The rim line sits right after the emissive map chunk and before the lights sum into outgoingLight.
      expect(wet.indexOf(RIM_LINE)).toBeGreaterThan(wet.indexOf('#include <emissivemap_fragment>'));
      expect(wet.indexOf(RIM_LINE)).toBeLessThan(wet.indexOf('vec3 outgoingLight'));
    }
  });

  it('patchRainRim throws, naming the chunk, when three`s source has no place for the rim', () => {
    expect(() => patchRainRim('void main() {}')).toThrow(/#include <common>/);
    expect(() => patchRainRim('#include <common>\nvoid main() {}')).toThrow(/#include <emissivemap_fragment>/);
  });

  it('the rim variant has its own program key, distinct from a plain wet clone`s and the dry one`s', () => {
    const rim = buildMeshUnitTemplate(sceneOf(PARTS), 'kdf', 'x.glb', false, undefined, undefined, WET_SURFACE_PARAMS);
    const plain = buildMeshUnitTemplate(sceneOf(PARTS), 'enemy', 'x.glb', false, undefined, undefined, WET_SURFACE_PARAMS);
    const dry = buildMeshUnitTemplate(sceneOf(PARTS), 'kdf', 'x.glb', false, undefined, undefined, SURFACE_PARAMS);
    const keys = new Set([...rim.materials, ...plain.materials, ...dry.materials].map((m) => m.customProgramCacheKey()));
    expect(keys.size).toBe(2);
    for (const m of rim.materials) expect(m.customProgramCacheKey().endsWith('|rl-unit-rain-rim')).toBe(true);
  });
});

describe('the shared uniforms', () => {
  it('every rim material compiles with the SAME uniform objects, so one write moves them all', () => {
    const a = buildMeshUnitTemplate(sceneOf(PARTS), 'kdf', 'a.glb', false, undefined, undefined, WET_SURFACE_PARAMS);
    const b = buildMeshUnitTemplate(sceneOf(PARTS), 'kdf', 'b.glb', false, undefined, undefined, WET_SURFACE_PARAMS);
    const all = [...a.materials, ...b.materials].map((m) => compile(m).uniforms);
    expect(all).toHaveLength(8);
    for (const u of all) {
      expect(u.uRimGain).toBe(all[0].uRimGain);
      expect(u.uRimColor).toBe(all[0].uRimColor);
      expect(u.uRimPower).toBe(all[0].uRimPower);
    }
    expect(all[0].uRimGain).toBe(rimUniforms().gain);
    expect(all[0].uRimGain.value).toBe(0.4);
    setRainRimGain(0.9);
    for (const u of all) expect(u.uRimGain.value).toBe(0.9);
  });

  it('carries overcast.1 in linear, the shipped provisional gain 0.4 and power 3 (literals)', () => {
    const u = rimUniforms();
    expect(u.colour.value.r).toBeCloseTo(0.3467, 4);
    expect(u.colour.value.g).toBeCloseTo(0.39676, 4);
    expect(u.colour.value.b).toBeCloseTo(0.46207, 4);
    expect(u.gain.value).toBe(0.4);
    expect(u.power.value).toBe(3);
  });

  it('gain 0 is no rim contribution: the debug layer off writes 0 into every compiled program`s uniform', () => {
    const t = buildMeshUnitTemplate(sceneOf(PARTS), 'kdf', 'x.glb', false, undefined, undefined, WET_SURFACE_PARAMS);
    const gains = t.materials.map((m) => compile(m).uniforms.uRimGain);
    setUnitSurfacePass(false);
    for (const g of gains) expect(g.value).toBe(0);
    setUnitSurfacePass(true);
    for (const g of gains) expect(g.value).toBe(0.4);
  });
});

describe('the wounded copy keeps the rim', () => {
  it('a wounded KDF copy under rain carries the rim AND the floor, with both program keys and the shared uniforms', () => {
    const t = buildMeshUnitTemplate(sceneOf(PARTS), 'kdf', 'x.glb', false, undefined, undefined, WET_SURFACE_PARAMS);
    const rimmed = t.materials.map((m) => compile(m).uniforms.uRimGain);
    const copies = liftWoundedTemplate(t.root);
    expect(copies).toHaveLength(4);
    for (const c of copies) {
      const { fragmentShader, uniforms } = compile(c);
      expect(fragmentShader).toContain(RIM_LINE);
      expect(fragmentShader).toContain('uniform float uWoundedFloor;');
      expect(uniforms.uRimGain).toBe(rimmed[0]);
      expect(uniforms.uWoundedFloor).toBeDefined();
      const key = c.customProgramCacheKey();
      expect(key).toContain('|rl-unit-rain-rim|');
      expect(key.endsWith('|rl-wounded-floor')).toBe(true);
    }
  });

  it('a wounded copy of a DRY figure has the floor and no rim', () => {
    const t = buildMeshUnitTemplate(sceneOf(PARTS), 'kdf', 'x.glb', false, undefined, undefined, SURFACE_PARAMS);
    for (const c of liftWoundedTemplate(t.root)) {
      const { fragmentShader, uniforms } = compile(c);
      expect(fragmentShader).not.toContain('uRimGain');
      expect(uniforms.uRimGain).toBeUndefined();
      expect(fragmentShader).toContain('uniform float uWoundedFloor;');
      expect(c.customProgramCacheKey()).not.toContain('rl-unit-rain-rim');
    }
  });
});
