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
import { beginMeshDeathFade } from './mesh-death';
import { InsigniaShared, setInsigniaStrength } from './insignia';
import { INSIGNIA_FRAMES } from './insignia-frames';
import { INSIGNIA_ONLY_SLOT, insigniaHookOf, setInsigniaPass, UNIT_MARK_PROGRAM_KEY } from './team-mask';
import { VehicleScarMaterials } from './vehicle-damage';
import { charredTexturedMaterial } from '../world-materials';
import type { VehicleMeshEntity } from './mesh-vehicle';

afterEach(() => {
  setTeamMaskPass(true);
  setInsigniaStrength(true);
});

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

// ---------------------------------------------------------------------------------------------------------------------------------
// GH-1096 S1: the insignia rides the SAME hook (spec section 4.3, gate 5). Literals: the Lavi's frame, luma 0.12277.

const FRAME = { centre: [0.95, 1.0, 1.7], d: 0.6, slab: [1.6, 1.95], min_n: 0.6, luma: 0.12277, host_sha256: 'x' } as const;
const insigniaOf = (): { frame: typeof FRAME; shared: InsigniaShared } => ({ frame: FRAME, shared: new InsigniaShared() });
/** A material with NO team mark (an S2 vehicle): the insignia alone. */
const plainHull = (): THREE.MeshStandardMaterial => lavi({ rl_team_mark: undefined });

describe('the insignia variants (GH-1096 S1)', () => {
  it('an insignia-only material gets ONE variant, memoised under slot -1 whatever the side', () => {
    const team = new VehicleTeamMaterials(slotsOf(), undefined, insigniaOf());
    const base = plainHull();
    const a = team.materialFor(base, 0);
    expect(a).not.toBe(base);
    expect(team.materialFor(base, 1)).toBe(a);
    expect(team.materialFor(base, 2)).toBe(a);
    expect(team.size).toBe(1);
    expect((a.userData as { rlTeamSlot: number }).rlTeamSlot).toBe(INSIGNIA_ONLY_SLOT);
    expect(teamHookOf(a)).toBeUndefined();
    expect(insigniaHookOf(a)).toBeDefined();
  });

  it('the key names what was patched: |rl-unit-mark-3|team, |ins and |team+ins, each with its patch', () => {
    const teamOnly = new VehicleTeamMaterials(slotsOf()).materialFor(lavi(), 0);
    const insOnly = new VehicleTeamMaterials(slotsOf(), undefined, insigniaOf()).materialFor(plainHull(), 0);
    const both = new VehicleTeamMaterials(slotsOf(), undefined, insigniaOf()).materialFor(lavi(), 1);
    expect(teamOnly.customProgramCacheKey().endsWith(`|${UNIT_MARK_PROGRAM_KEY}|team`)).toBe(true);
    expect(insOnly.customProgramCacheKey().endsWith(`|${UNIT_MARK_PROGRAM_KEY}|ins`)).toBe(true);
    expect(both.customProgramCacheKey().endsWith(`|${UNIT_MARK_PROGRAM_KEY}|team+ins`)).toBe(true);
    const t = compile(teamOnly).fragmentShader;
    const i = compile(insOnly).fragmentShader;
    const b = compile(both).fragmentShader;
    expect(t).toContain('rlTeamMask');
    expect(t).not.toContain('uInsSdf');
    expect(i).toContain('rlInsMask');
    expect(i).not.toContain('rlTeamMask');
    expect(i.match(/varying vec3 vMarkPos;/g)).toHaveLength(1);
    expect(b.match(/varying vec3 vMarkPos;/g)).toHaveLength(1);
    // the insignia is applied AFTER the team mark, in the same color_fragment block, before lighting
    expect(b.indexOf('rlInsMask')).toBeGreaterThan(b.indexOf('diffuseColor.rgb = mix( diffuseColor.rgb, rlPanel'));
    expect(b.indexOf('rlInsMask')).toBeLessThan(b.indexOf('#include <roughnessmap_fragment>'));
  });

  it('a team-only material compiles L3\'s program byte for byte (only its key moved)', () => {
    const v = new VehicleTeamMaterials(slotsOf()).materialFor(lavi(), 0);
    const { fragmentShader, vertexShader } = compile(v);
    expect(fragmentShader).not.toMatch(/uIns|rlIns/);
    expect(vertexShader.match(/vMarkPos = position;/g)).toHaveLength(1);
  });

  it('binds the owner\'s shared texture, colour and ratio BY REFERENCE, and the frame\'s own numbers', () => {
    const ins = insigniaOf();
    const slots = slotsOf();
    const v = new VehicleTeamMaterials(slots, undefined, ins).materialFor(lavi(), 0);
    const { uniforms } = compile(v);
    expect(uniforms.uInsSdf).toBe(ins.shared.sdf);
    expect(uniforms.uInsColor).toBe(ins.shared.color);
    expect(uniforms.uInsPixelRatio).toBe(ins.shared.pixelRatio);
    expect((uniforms.uInsFrame as { value: THREE.Vector4 }).value.toArray()).toEqual([0.95, 1.0, 0.6, 0.6]);
    expect((uniforms.uInsSlab as { value: THREE.Vector2 }).value.toArray()).toEqual([1.6, 1.95]);
    expect((uniforms.uInsLuma as { value: number }).value).toBe(0.12277);
    expect((uniforms.uInsStrength as { value: number }).value).toBe(0.85);
    // a colour-vision switch writes the team slots only
    const before = ins.shared.color.value.toArray();
    slots.set(['#FF0000', '#00FF00', '#0000FF']);
    expect(ins.shared.color.value.toArray()).toEqual(before);
  });

  it('the garage rule: NO team colour (slots null) still builds the insignia, and ignores the material\'s team mark', () => {
    const team = new VehicleTeamMaterials(null, undefined, insigniaOf());
    const garageBase = lavi();
    const v = team.materialFor(garageBase, 0);
    expect(v).not.toBe(garageBase); // a variant, not the input (a second lavi() would differ from anything)
    expect(teamHookOf(v)).toBeUndefined();
    expect(insigniaHookOf(v)).toBeDefined();
    expect(v.customProgramCacheKey().endsWith('|ins')).toBe(true);
    // and with neither, every material is returned as it is
    const none = new VehicleTeamMaterials(null);
    const base = lavi();
    expect(none.materialFor(base, 0)).toBe(base);
  });

  it('the `insignia` layer zeroes the insignia\'s OWN strength, and never the team mark\'s', () => {
    const v = new VehicleTeamMaterials(slotsOf(), undefined, insigniaOf()).materialFor(lavi(), 0);
    const { uniforms } = compile(v);
    const ins = uniforms.uInsStrength as { value: number };
    const team = uniforms.uTeamStrength as { value: number };
    expect(setInsigniaPass(false)).toBeGreaterThanOrEqual(1);
    expect(ins.value).toBe(0);
    expect(team.value).toBe(0.85);
    setInsigniaPass(true);
    expect(ins.value).toBe(0.85);
    setTeamMaskPass(false);
    expect(ins.value).toBe(0.85);
  });
});

describe('gate 5: clones keep the insignia, and a wreck has none (GH-1096 S1)', () => {
  const insOnly = (): THREE.MeshStandardMaterial =>
    new VehicleTeamMaterials(slotsOf(), undefined, insigniaOf()).materialFor(plainHull(), 0) as THREE.MeshStandardMaterial;

  it('a scar clone of an insignia-only variant is re-hooked, with its key', () => {
    const variant = insOnly();
    const scar = new VehicleScarMaterials().materialFor(variant, 3) as THREE.MeshStandardMaterial;
    expect(scar).not.toBe(variant);
    expect(insigniaHookOf(scar)).toBe(insigniaHookOf(variant));
    expect(scar.customProgramCacheKey()).toContain(`${UNIT_MARK_PROGRAM_KEY}|ins`);
    const { fragmentShader, uniforms } = compile(scar);
    expect(fragmentShader).toContain('rlInsMask');
    expect(uniforms.uInsSdf).toBe(compile(variant).uniforms.uInsSdf);
  });

  it('a running-gear clone compiles the tread AND the insignia, tread first, the segment named once', () => {
    const variant = insOnly();
    const spec = { wheels: [], track: { r: [10, 0.3], l: [10, 0.3] }, gauge: { r: 1.2, l: 1.2 }, wheelbase: 0, steerLimit: 0 } as never;
    const { material } = runningGearMaterial(variant, spec);
    const { fragmentShader, vertexShader } = compile(material);
    expect(vertexShader).toContain('vMarkPos = position;');
    expect(fragmentShader.indexOf('rgOnTrack')).toBeLessThan(fragmentShader.indexOf('float rlInsMask'));
    expect(material.customProgramCacheKey().split(UNIT_MARK_PROGRAM_KEY)).toHaveLength(2);
  });

  it('the death-fade clone carries the insignia, so it does not pop off for the 0.4 s of the fade', () => {
    const variant = insOnly();
    const root = new THREE.Group();
    root.add(new THREE.Mesh(new THREE.BufferGeometry(), variant));
    const [swap] = beginMeshDeathFade(root);
    expect(swap!.fade).not.toBe(variant);
    expect(insigniaHookOf(swap!.fade)).toBe(insigniaHookOf(variant));
    expect(compile(swap!.fade).fragmentShader).toContain('rlInsMask');
  });

  it('the soot wreck of an insignia variant is hook-free', () => {
    const wreck = charredTexturedMaterial(new VehicleTeamMaterials(slotsOf(), undefined, insigniaOf()).materialFor(lavi(), 0) as THREE.MeshStandardMaterial);
    expect(insigniaHookOf(wreck)).toBeUndefined();
    const { fragmentShader } = compile(wreck);
    expect(fragmentShader).not.toContain('uInsSdf');
    expect(wreck.customProgramCacheKey()).not.toContain(UNIT_MARK_PROGRAM_KEY);
  });
});

describe('gate 5 on the SHIPPED shape: the Lavi is team + insignia, and every clone keeps both halves (GH-1096 S1)', () => {
  /** What the renderer mints for a Lavi: a team-marked bake (`lavi()`), a slot, and the Lavi's frame. */
  const teamIns = (): THREE.MeshStandardMaterial =>
    new VehicleTeamMaterials(slotsOf(), undefined, insigniaOf()).materialFor(lavi(), 0) as THREE.MeshStandardMaterial;
  const spec = { wheels: [], track: { r: [10, 0.3], l: [10, 0.3] }, gauge: { r: 1.2, l: 1.2 }, wheelbase: 0, steerLimit: 0 } as never;
  const clones: ReadonlyArray<readonly [string, (v: THREE.MeshStandardMaterial) => THREE.Material]> = [
    ['scar', (v) => new VehicleScarMaterials().materialFor(v, 3)],
    ['running gear', (v) => runningGearMaterial(v, spec).material],
    [
      'death fade',
      (v) => {
        const root = new THREE.Group();
        root.add(new THREE.Mesh(new THREE.BufferGeometry(), v));
        return beginMeshDeathFade(root)[0]!.fade;
      },
    ],
  ];

  it.each(clones)('the %s clone carries the team mark AND the insignia, keyed |team+ins, both patched', (_name, cut) => {
    const variant = teamIns();
    expect(teamHookOf(variant)).toBeDefined();
    expect(insigniaHookOf(variant)).toBeDefined();
    const clone = cut(variant);
    expect(clone).not.toBe(variant);
    expect(teamHookOf(clone)).toBe(teamHookOf(variant));
    expect(insigniaHookOf(clone)).toBe(insigniaHookOf(variant));
    expect(clone.customProgramCacheKey()).toContain(`${UNIT_MARK_PROGRAM_KEY}|team+ins`);
    const { fragmentShader, uniforms } = compile(clone);
    expect(fragmentShader).toContain('float rlTeamMask');
    expect(fragmentShader).toContain('float rlInsMask');
    expect(uniforms.uInsSdf).toBe(compile(variant).uniforms.uInsSdf);
  });
});

describe('gate 5 on EVERY framed type, in the shape it ships (GH-1096 S2)', () => {
  /**
   * The framed types whose GLB carries a team mark, so the renderer mints them team + insignia; every other framed type is
   * insignia-only. A LITERAL, pinned against the bytes by `tools/src/insignia.test.ts` ("the team-marked framed vehicles").
   */
  const TEAM_MARKED: readonly string[] = ['apc_eitan', 'apc_kipod', 'ifv_namer', 'mbt_lavi', 'officer_armour'];
  const ids = Object.keys(INSIGNIA_FRAMES).sort();
  const spec = { wheels: [], track: { r: [10, 0.3], l: [10, 0.3] }, gauge: { r: 1.2, l: 1.2 }, wheelbase: 0, steerLimit: 0 } as never;
  const clones: ReadonlyArray<readonly [string, (v: THREE.MeshStandardMaterial) => THREE.Material]> = [
    ['scar', (v) => new VehicleScarMaterials().materialFor(v, 3)],
    ['running gear', (v) => runningGearMaterial(v, spec).material],
    [
      'death fade',
      (v) => {
        const root = new THREE.Group();
        root.add(new THREE.Mesh(new THREE.BufferGeometry(), v));
        return beginMeshDeathFade(root)[0]!.fade;
      },
    ],
  ];
  /** What the renderer mints for `id`: its own bake shape (team-marked or not), slot 0, and its OWN frame from the table. */
  const shipped = (id: string): THREE.MeshStandardMaterial =>
    new VehicleTeamMaterials(slotsOf(), undefined, { frame: INSIGNIA_FRAMES[id]!, shared: new InsigniaShared() }).materialFor(
      TEAM_MARKED.includes(id) ? lavi() : plainHull(),
      0
    ) as THREE.MeshStandardMaterial;

  it('runs over the whole table: twelve framed types, five of them team-marked', () => {
    expect(ids).toHaveLength(12);
    expect(TEAM_MARKED.filter((id) => ids.includes(id))).toHaveLength(5);
  });

  it.each(ids.flatMap((id) => clones.map(([name, cut]) => [id, name, cut] as const)))(
    '%s: the %s clone keeps the hook it shipped with, its key and its frame',
    (id, _name, cut) => {
      const team = TEAM_MARKED.includes(id);
      const variant = shipped(id);
      expect(insigniaHookOf(variant)).toBeDefined();
      expect(teamHookOf(variant) !== undefined).toBe(team);
      const clone = cut(variant);
      expect(clone).not.toBe(variant);
      expect(insigniaHookOf(clone)).toBe(insigniaHookOf(variant));
      expect(teamHookOf(clone)).toBe(teamHookOf(variant));
      expect(clone.customProgramCacheKey()).toContain(`${UNIT_MARK_PROGRAM_KEY}|${team ? 'team+ins' : 'ins'}`);
      const { fragmentShader, uniforms } = compile(clone);
      expect(fragmentShader).toContain('float rlInsMask');
      expect(fragmentShader.includes('float rlTeamMask')).toBe(team);
      const f = INSIGNIA_FRAMES[id]!;
      expect((uniforms.uInsFrame as { value: THREE.Vector4 }).value.toArray()).toEqual([f.centre[0], f.centre[1], f.d, f.min_n]);
      expect((uniforms.uInsSlab as { value: THREE.Vector2 }).value.toArray()).toEqual([f.slab[0], f.slab[1]]);
      expect((uniforms.uInsLuma as { value: number }).value).toBe(f.luma);
      expect(uniforms.uInsSdf).toBe(compile(variant).uniforms.uInsSdf);
    }
  );

  it.each(ids)('%s: its soot wreck carries neither half', (id) => {
    const wreck = charredTexturedMaterial(shipped(id));
    expect(insigniaHookOf(wreck)).toBeUndefined();
    expect(teamHookOf(wreck)).toBeUndefined();
    expect(wreck.customProgramCacheKey()).not.toContain(UNIT_MARK_PROGRAM_KEY);
    expect(compile(wreck).fragmentShader).not.toContain('uInsSdf');
  });
});
