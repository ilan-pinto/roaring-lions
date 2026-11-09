/**
 * L3 (GH-943): the team mark at the material level.
 *
 * Oracles are LITERALS: team.own is `#2F6FD9` (linear 0.0284, 0.1590, 0.6939), the strength 0.85 is the lead's
 * ruling of 2 Nov. Programs are compiled from three's own meshphysical sources (`ShaderChunk`), never a hand-written
 * stand-in, so a chunk three renames fails here.
 */
import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  MARK_ROLE,
  TEAM_MASK_PROGRAM_KEY,
  TEAM_MASK_STRENGTH,
  TeamMaskSlots,
  VehicleTeamMaterials,
  carryTeamMark,
  setTeamMaskPass,
  teamHookOf,
  teamMarkOf,
} from './team-mask';
import { runningGearMaterial } from './running-gear-material';
import { VehicleScarMaterials } from './vehicle-damage';
import { charredTexturedMaterial } from '../world-materials';
import type { VehicleMeshEntity } from './mesh-vehicle';

afterEach(() => setTeamMaskPass(true));

const tex = (): THREE.DataTexture => new THREE.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1);

const MARK = {
  version: 1,
  roof: { x: [-1.7, -0.4], z_half: 0.7, y: [2.28, 2.56], min_ny: 0.6 },
  band: { x: [-1.7, -0.4], y: [2.12, 2.3], min_nz: 0.6 },
  exclude_uv: [[0.28149, 0.21069], [0.26978, 0.26538], [0.86938, 0.82397]],
  exclude_radius: 0.0002,
  luma: 0.17655,
  team_fraction: 0.021,
};

/** What `GLTFLoader` hands over for the Lavi: a bake, and the mark in the material's extras. */
function lavi(over: Record<string, unknown> = {}): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ map: tex() });
  m.map!.colorSpace = THREE.SRGBColorSpace;
  m.userData = { rl_bake_luma: 0.09, rl_team_mark: MARK, ...over };
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
  it('one per (base x slot), memoised; a base that declares no mark is returned as it is', () => {
    const team = new VehicleTeamMaterials(slotsOf());
    const base = lavi();
    const a0 = team.materialFor(base, 0);
    const a1 = team.materialFor(base, 1);
    expect(a0).not.toBe(base);
    expect(a0).not.toBe(a1);
    expect(team.materialFor(base, 0)).toBe(a0);
    expect(team.size).toBe(2);
    const plain = lavi({ rl_team_mark: undefined });
    expect(teamMarkOf(plain)).toBeNull();
    expect(team.materialFor(plain, 0)).toBe(plain);
    expect(() => team.materialFor(base, 3)).toThrow(/colour slot 3/);
  });

  it('share the template\'s texture by reference (+0 uploads) and need none of their own', () => {
    const base = lavi();
    const v = new VehicleTeamMaterials(slotsOf()).materialFor(base, 2) as THREE.MeshStandardMaterial;
    expect(v.map).toBe(base.map);
    expect(v.normalMap).toBeNull();
    expect(v.roughnessMap).toBeNull();
  });

  it('only a HULL-role mesh is swapped: the barrel, the antennas and the tracks keep their material', () => {
    const base = lavi();
    const hull = new THREE.Mesh(new THREE.BufferGeometry(), base);
    hull.userData = { rl_role: MARK_ROLE };
    const metal = new THREE.Mesh(new THREE.BufferGeometry(), base);
    metal.userData = { rl_role: 'metal' };
    const rubber = new THREE.Mesh(new THREE.BufferGeometry(), base);
    rubber.userData = { rl_role: 'rubber' };
    const top = new THREE.Group();
    top.add(hull, metal, rubber);
    const wreck = new THREE.Mesh(new THREE.BufferGeometry(), base); // death_root is not in liveTop
    wreck.userData = { rl_role: MARK_ROLE, rl_wreck: true };
    const entity = { liveTop: [top] } as unknown as VehicleMeshEntity;
    expect(new VehicleTeamMaterials(slotsOf()).applyTo(entity, 1)).toBe(1);
    expect(hull.material).not.toBe(base);
    expect(metal.material).toBe(base);
    expect(rubber.material).toBe(base);
    expect(wreck.material).toBe(base);
  });

  it('compile with the hook at color_fragment, after map_fragment and before lighting', () => {
    const v = new VehicleTeamMaterials(slotsOf()).materialFor(lavi(), 0);
    const { fragmentShader, uniforms } = compile(v);
    const at = (s: string): number => fragmentShader.indexOf(s);
    expect(at('float rlTeamMask')).toBeGreaterThan(at('#include <map_fragment>'));
    expect(at('float rlTeamMask')).toBeLessThan(at('#include <roughnessmap_fragment>'));
    expect(fragmentShader).toContain('uniform vec4 uMarkA;');
    expect((uniforms.uTeamStrength as { value: number }).value).toBe(0.85);
    expect(TEAM_MASK_STRENGTH).toBe(0.85);
    expect(v.customProgramCacheKey()).toContain(TEAM_MASK_PROGRAM_KEY);
  });

  it('tests the OBJECT-space position and normal, never a world matrix: the mark turns with the turret', () => {
    const { vertexShader, fragmentShader } = compile(new VehicleTeamMaterials(slotsOf()).materialFor(lavi(), 0));
    expect(vertexShader).toContain('vMarkPos = position;');
    expect(vertexShader).toContain('vMarkNrm = normal;');
    const hook = fragmentShader.slice(fragmentShader.indexOf('float rlTeamMask') - 900, fragmentShader.indexOf('diffuseColor.rgb = mix( diffuseColor.rgb, rlPanel'));
    expect(hook).toContain('vMarkPos');
    expect(hook).not.toMatch(/modelMatrix|worldPosition|vWorldPosition|viewMatrix/);
  });

  it('puts the lead\'s boxes into the uniforms, and every variant of a slot shares ONE colour uniform', () => {
    const team = new VehicleTeamMaterials(slotsOf());
    const a = compile(team.materialFor(lavi(), 0));
    const b = compile(team.materialFor(lavi(), 0));
    const c = compile(team.materialFor(lavi(), 1));
    expect((a.uniforms.uMarkA as { value: THREE.Vector4 }).value.toArray()).toEqual([-1.7, -0.4, 0.7, 0.6]);
    expect((a.uniforms.uMarkC as { value: THREE.Vector4 }).value.toArray()).toEqual([-1.7, -0.4, 2.12, 2.3]);
    expect((a.uniforms.uMarkKit as { value: THREE.Vector2[] }).value).toHaveLength(3);
    expect(a.uniforms.uTeamColor).toBe(b.uniforms.uTeamColor);
    expect(a.uniforms.uTeamColor).not.toBe(c.uniforms.uTeamColor);
    expect((a.uniforms.uTeamLuma as { value: number }).value).toBe(0.17655);
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

describe('clones keep the mark, and a wreck has none', () => {
  it('a scar clone is re-hooked (Material.clone drops onBeforeCompile) and its key names the hook', () => {
    const team = new VehicleTeamMaterials(slotsOf());
    const variant = team.materialFor(lavi(), 0) as THREE.MeshStandardMaterial;
    const scar = new VehicleScarMaterials().materialFor(variant, 3) as THREE.MeshStandardMaterial;
    expect(scar).not.toBe(variant);
    expect(teamHookOf(scar)).toBe(teamHookOf(variant));
    expect(scar.customProgramCacheKey()).toContain(TEAM_MASK_PROGRAM_KEY);
    const { fragmentShader, vertexShader, uniforms } = compile(scar);
    expect(fragmentShader).toContain('rlTeamMask');
    expect(vertexShader).toContain('vMarkPos');
    expect(uniforms.uTeamColor).toBe(compile(variant).uniforms.uTeamColor);
  });

  it('a running-gear clone compiles BOTH the tread and the mark, tread first, one program key', () => {
    const variant = new VehicleTeamMaterials(slotsOf()).materialFor(lavi(), 0);
    const spec = { wheels: [], track: { r: [10, 0.3], l: [10, 0.3] }, gauge: { r: 1.2, l: 1.2 }, wheelbase: 0, steerLimit: 0 } as never;
    const { material } = runningGearMaterial(variant, spec);
    const { fragmentShader, vertexShader } = compile(material);
    expect(vertexShader).toContain('rgApply');
    expect(vertexShader).toContain('vMarkPos = position;');
    expect(fragmentShader).toContain('rgBarIntegral');
    expect(fragmentShader.indexOf('rgOnTrack')).toBeLessThan(fragmentShader.indexOf('float rlTeamMask'));
    const key = material.customProgramCacheKey();
    expect(key.split(TEAM_MASK_PROGRAM_KEY)).toHaveLength(2); // named once, not twice
    expect(key).toContain('rl-running-gear');
  });

  it('a clone of a material with no hook gets none and no key', () => {
    const base = lavi();
    const scar = base.clone();
    carryTeamMark(scar, base);
    expect(Object.prototype.hasOwnProperty.call(scar, 'onBeforeCompile')).toBe(false);
    expect(scar.customProgramCacheKey()).not.toContain(TEAM_MASK_PROGRAM_KEY);
  });

  it('the soot wreck is hook-free', () => {
    const wreck = charredTexturedMaterial(lavi());
    expect(teamHookOf(wreck)).toBeUndefined();
    const { fragmentShader, vertexShader } = compile(wreck);
    expect(fragmentShader).not.toContain('uTeamColor');
    expect(vertexShader).not.toContain('vMarkPos');
    expect(wreck.customProgramCacheKey()).not.toContain(TEAM_MASK_PROGRAM_KEY);
  });
});
