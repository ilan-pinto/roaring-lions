/**
 * @vitest-environment jsdom
 *
 * GH-943 P3 (T3) gates for the node unit twin's composer (`unit-material.node.ts`), built by the backend's own factory body from
 * REAL legacy materials (team variants, running-gear clones, scars, fades, a rain-rim figure, a cold GLB texture) through the real
 * shared-twin memo (`adoptMaterials`), and compiled by three's `GLSLNodeBuilder`. Each gate has a one-line falsification, run by
 * hand and listed in the commit message:
 *  - G7 the chain order: reverse the term table's iteration in the composer (`for (... of [...table].reverse())`);
 *  - P3-R3 per-entity fields per object: make `objectUniform` material-scoped (`onRenderUpdate` reading the first legacy user);
 *  - G9 a late texture is sampled: bind the 1x1 placeholder by value (`T.texture(new W.Texture(base.map.image))` for the map tap);
 *  - the material-wide mirror: drop the `OnBeforeMaterialUpdate(sync)` from the colour graph;
 *  - the unported terms: drop the `unported` list from the twin's `userData`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { TEAM_MASK_PROGRAM_KEY, TeamMaskSlots, VehicleTeamMaterials, setTeamMaskPass } from './team-mask';
import { RG_PROGRAM_KEY, runningGearMaterial } from './running-gear-material';
import { parseRunningGear, type RunningGearSpec } from './running-gear';
import { VehicleScarMaterials } from './vehicle-damage';
import { beginMeshDeathFade, setMeshDeathOpacity } from './mesh-death';
import { RAIN_RIM_PROGRAM_KEY, applyRainRim } from './rain-rim';
import { WOUNDED_FLOOR_PROGRAM_KEY } from './wounded-read';
import { SOOT_PROGRAM_KEY } from '../world-materials';
import { UNIT_HOOK_SEGMENTS } from '../material-names';
import { censusUnported, PORTED_MATERIAL_KEYS, UNPORTED_TERMS_KEY } from '../backend/unported';
import { hasColdTextures, markColdTexture, warmColdTextures } from './gltf-loader';
import { bindRunningGear } from './running-gear-binding';
import type { VehicleMeshEntity } from './mesh-vehicle';
import { UNIT_TERM_ORDER, nodeUnitBindings } from './unit-material.node';
import { TEAM_MARK_SEGMENT } from './team-mask.node';
import { RUNNING_GEAR_SEGMENT } from './running-gear.node';
import { SOOT_SEGMENT } from '../world-materials.node';
import {
  adoptUnits,
  bindingsOf,
  compile,
  compileWgsl,
  laviMaterial,
  mainOf,
  runUpdate,
  taggedGeometry,
  uniformOf,
  unitDeps,
  unitFactory,
  type UnitDeps,
} from './unit-twin.test-support';

afterEach(() => setTeamMaskPass(true));

const SPEC = parseRunningGear(
  { rl_running_gear: { version: 1, wheels: [{ side: 'r', index: 0, centre: [1, 0.4, 0.9], radius: 0.4, cutRadius: 0.41, steer: false, maxSteerRad: 0 }], tracks: [] } },
  'fixture'
) as RunningGearSpec;

const slotsOf = (): TeamMaskSlots => new TeamMaskSlots(['#2F6FD9', '#D93A2B', '#F2E8D5']);

describe('the term order is the legacy chain order, pinned to the legacy keys', () => {
  it('soot, running gear, team mark, rain rim, wounded floor: every unit hook, each literal its legacy constant', () => {
    expect(UNIT_TERM_ORDER).toEqual([SOOT_PROGRAM_KEY, RG_PROGRAM_KEY, TEAM_MASK_PROGRAM_KEY, RAIN_RIM_PROGRAM_KEY, WOUNDED_FLOOR_PROGRAM_KEY]);
    expect(new Set(UNIT_TERM_ORDER)).toEqual(UNIT_HOOK_SEGMENTS);
    expect([SOOT_SEGMENT, RUNNING_GEAR_SEGMENT, TEAM_MARK_SEGMENT]).toEqual([SOOT_PROGRAM_KEY, RG_PROGRAM_KEY, TEAM_MASK_PROGRAM_KEY]);
  });

  it('the three ported segments are on PORTED_MATERIAL_KEYS (read per segment); the rim and the floor are not', () => {
    for (const k of [TEAM_MASK_PROGRAM_KEY, RG_PROGRAM_KEY, SOOT_PROGRAM_KEY]) expect(PORTED_MATERIAL_KEYS.has(k), k).toBe(true);
    for (const k of [RAIN_RIM_PROGRAM_KEY, WOUNDED_FLOOR_PROGRAM_KEY]) expect(PORTED_MATERIAL_KEYS.has(k), k).toBe(false);
  });
});

describe('G7: a running-gear-plus-team clone composes both terms, the mark AFTER the tread', () => {
  it('whatever the key\'s order (the clone appends its own segment), the tread is computed first and the mark reads it', async () => {
    const d = await unitDeps();
    const variant = new VehicleTeamMaterials(slotsOf()).materialFor(laviMaterial(), 0) as THREE.MeshStandardMaterial;
    const { material } = runningGearMaterial(variant, SPEC);
    // The key names the mark first: the order is NOT read off the key.
    expect(material.customProgramCacheKey().endsWith(`|${TEAM_MASK_PROGRAM_KEY}|${RG_PROGRAM_KEY}`)).toBe(true);
    const twin = unitFactory(d)(material as THREE.MeshStandardMaterial);
    expect(bindingsOf(twin).applied).toEqual([RG_PROGRAM_KEY, TEAM_MASK_PROGRAM_KEY]);
    const frag = mainOf(compile(d, new THREE.Mesh(taggedGeometry(1, 0.5), twin), twin).fragment);
    const tread = frag.indexOf('rlUnitColorTread = ');
    const team = frag.indexOf('rlUnitColorTeam = ');
    expect(tread).toBeGreaterThan(0);
    expect(team).toBeGreaterThan(tread);
    // The mark mixes INTO the treaded colour, and its luma (the grime) is the treaded colour's.
    const teamLine = frag.slice(team, frag.indexOf(';', team));
    expect(teamLine).toContain('mix( rlUnitColorTread.x,');
    expect(frag).toMatch(/mix\( 1\.0, \( \( \( \( rlUnitColorTread\.x \* 0\.2126 \)/);
    expect(frag).toContain('DiffuseColor = rlUnitColorTeam;');
  });
});

/** Adopts every mesh under a fresh scene with the unit-only kit. */
function adoptAll(d: UnitDeps, meshes: THREE.Mesh[]): void {
  const scene = new THREE.Scene();
  for (const m of meshes) scene.add(m);
  adoptUnits(d, scene);
}

describe('ruling P3-R3: two entities sharing one twin each draw their own per-entity fields', () => {
  it('two FADE clones of one variant (the death fade, transparent) share one twin, and each object reads its own opacity', async () => {
    const d = await unitDeps();
    const variant = new VehicleTeamMaterials(slotsOf()).materialFor(laviMaterial(), 0) as THREE.MeshStandardMaterial;
    const roots = [0, 1].map(() => new THREE.Group().add(new THREE.Mesh(taggedGeometry(0), variant)));
    const fades = roots.map((r) => beginMeshDeathFade(r));
    const meshes = roots.map((r) => r.children[0] as THREE.Mesh);
    expect(meshes[0]?.material).not.toBe(meshes[1]?.material); // two legacy clones...
    const scene = new THREE.Scene();
    for (const r of roots) scene.add(r);
    adoptUnits(d, scene);
    const [ma, mb] = meshes as [THREE.Mesh, THREE.Mesh];
    expect(ma.material).toBe(mb.material); // ...one twin
    const twin = ma.material as THREE.Material;
    expect(twin.transparent).toBe(true);
    setMeshDeathOpacity(fades[0] ?? [], 0.25);
    setMeshDeathOpacity(fades[1] ?? [], 0.75);
    const opacity = uniformOf(twin, 'uUnitOpacity');
    runUpdate(opacity, ma);
    expect(opacity.value).toBe(0.25);
    runUpdate(opacity, mb);
    expect(opacity.value).toBe(0.75);
    runUpdate(opacity, ma);
    expect(opacity.value).toBe(0.25);
    // And the mark rides on the fade (the legacy fade carries it).
    expect(bindingsOf(twin).applied).toEqual([TEAM_MASK_PROGRAM_KEY]);
  });

  it('two SCAR clones of one variant at different bands share one twin, and each object reads its own colour and roughness', async () => {
    const d = await unitDeps();
    const variant = new VehicleTeamMaterials(slotsOf()).materialFor(laviMaterial(), 0) as THREE.MeshStandardMaterial;
    const scars = new VehicleScarMaterials();
    const s2 = scars.materialFor(variant, 2) as THREE.MeshStandardMaterial;
    const s6 = scars.materialFor(variant, 6) as THREE.MeshStandardMaterial;
    expect(s2.color.equals(s6.color)).toBe(false);
    expect(s2.roughness).not.toBe(s6.roughness);
    const [a, b, clean] = [s2, s6, variant].map((m) => new THREE.Mesh(taggedGeometry(0), m)) as unknown as [THREE.Mesh, THREE.Mesh, THREE.Mesh];
    adoptAll(d, [a, b, clean]);
    expect(a.material).toBe(b.material);
    expect(clean.material).toBe(a.material);
    const twin = a.material as THREE.Material;
    const color = uniformOf(twin, 'uUnitColor');
    const rough = uniformOf(twin, 'uUnitRoughness');
    for (const [mesh, legacy] of [[a, s2], [b, s6], [clean, variant]] as const) {
      runUpdate(color, mesh);
      runUpdate(rough, mesh);
      expect(color.value).toBe(legacy.color);
      expect(rough.value).toBe(legacy.roughness);
    }
    // A write AFTER adoption (the scar re-applied in place on a running-gear clone) reaches the draw with no rebuild.
    s6.color.setRGB(0.1, 0.2, 0.3);
    runUpdate(color, b);
    expect((color.value as THREE.Color).toArray()).toEqual([0.1, 0.2, 0.3]);
  });

  it('every per-entity field is object-scoped; the material-wide ones mirror the BASE before each render', async () => {
    const d = await unitDeps();
    const variant = new VehicleTeamMaterials(slotsOf()).materialFor(laviMaterial(), 0) as THREE.MeshStandardMaterial;
    const twin = unitFactory(d)(variant);
    for (const name of ['uUnitColor', 'uUnitOpacity', 'uUnitRoughness', 'uUnitMetalness']) {
      expect((uniformOf(twin, name) as unknown as { updateType: string }).updateType, name).toBe('object');
    }
    // The colour graph registers the mirror as a before-render update (three runs it once per render, before the draw).
    const built = compile(d, new THREE.Mesh(taggedGeometry(0), twin), twin);
    expect(built.updateBefore.length).toBe(1);
    const env = new THREE.Texture();
    variant.envMap = env;
    variant.envMapIntensity = 0.4;
    const t = twin as THREE.MeshStandardMaterial;
    const v = t.version;
    (built.updateBefore[0] as { updateBefore(frame: unknown): void }).updateBefore({});
    expect(t.envMap).toBe(env);
    expect(t.envMapIntensity).toBe(0.4);
    expect(t.version).toBeGreaterThan(v); // an envMap that appears changes the program
    expect(t.map).toBe(variant.map);
    // The env layer (an intensity on node) follows with no rebuild.
    variant.envMapIntensity = 0;
    const v2 = t.version;
    bindingsOf(twin).sync();
    expect(t.envMapIntensity).toBe(0);
    expect(t.version).toBe(v2);
  });
});

describe('G9: a texture that lands after adoption is the image the twin samples', () => {
  it('a cold GLB texture warmed after adoption: the twin carries the very texture, the walk finds it through the twin, and the tap samples it', async () => {
    const d = await unitDeps();
    const map = new THREE.Texture();
    markColdTexture(map, new Blob(['x']));
    const variant = new VehicleTeamMaterials(slotsOf()).materialFor(laviMaterial(map), 0) as THREE.MeshStandardMaterial;
    const root = new THREE.Group().add(new THREE.Mesh(taggedGeometry(0), variant));
    const scene = new THREE.Scene().add(root);
    adoptUnits(d, scene);
    const mesh = root.children[0] as THREE.Mesh;
    const twin = mesh.material as THREE.MeshStandardMaterial;
    expect(nodeUnitBindings(twin)).not.toBeNull();
    // `warmColdTextures` walks `mesh.material`, which is the twin now.
    expect(hasColdTextures(root)).toBe(true);
    const bitmap = { width: 8, height: 8 } as ImageBitmap;
    await warmColdTextures(root, async () => bitmap);
    expect(map.source.data).toBe(bitmap);
    // What the colour graph's map tap resolves to on a draw of this twin (three's material reference, updated as on a render).
    const built = compile(d, mesh, twin);
    const taps = [...built.usedFragment].filter((n) => (n as { isTextureNode?: boolean }).isTextureNode === true) as Array<{ value: THREE.Texture; updateReference?(f: unknown): void; update?(f: unknown): void }>;
    expect(taps.length).toBeGreaterThan(0);
    const owners = [...built.usedFragment].filter((n) => (n as { isMaterialReferenceNode?: boolean }).isMaterialReferenceNode === true) as Array<{
      property: string;
      updateReference(f: unknown): void;
      update(f: unknown): void;
    }>;
    for (const r of owners) {
      r.updateReference({ material: twin, object: mesh });
      r.update({ material: twin, object: mesh });
    }
    const sampled = taps.map((t) => t.value);
    expect(sampled).toContain(map);
    expect(sampled.every((t) => t.image !== null && (t.image as { width?: number }).width === 8)).toBe(true);
  });
});

describe('the segments T3 does not draw are named, and drawn without', () => {
  it('a rain-rim figure (T4\'s) gets a twin that lists `rl-unit: rl-unit-rain-rim`, which the census reports as partial', async () => {
    const d = await unitDeps();
    const fig = new THREE.MeshStandardMaterial({ color: 0x808080 });
    applyRainRim(fig);
    const mesh = new THREE.Mesh(taggedGeometry(0), fig);
    adoptAll(d, [mesh]);
    const twin = mesh.material as THREE.Material;
    expect(bindingsOf(twin).applied).toEqual([]);
    expect((twin.userData as Record<string, unknown>)[UNPORTED_TERMS_KEY]).toEqual(['rl-unit: rl-unit-rain-rim']);
    expect(censusUnported(mesh.parent as THREE.Object3D)).toEqual([{ kind: 'partial', key: 'rl-unit: rl-unit-rain-rim', objects: 1 }]);
    // The legacy material never carries the twin's terms.
    expect((fig.userData as Record<string, unknown>)[UNPORTED_TERMS_KEY]).toBeUndefined();
  });

  it('a fully ported twin (team + running gear) has no unported term, and the node census names nothing for it', async () => {
    const d = await unitDeps();
    const variant = new VehicleTeamMaterials(slotsOf()).materialFor(laviMaterial(), 0) as THREE.MeshStandardMaterial;
    const { material } = runningGearMaterial(variant, SPEC);
    const mesh = new THREE.Mesh(taggedGeometry(1, 0.5), material);
    adoptAll(d, [mesh]);
    const twin = mesh.material as THREE.Material;
    expect((twin.userData as Record<string, unknown>)[UNPORTED_TERMS_KEY]).toEqual([]);
    expect(twin.name).toBe('rl-node-material-unit:team-mark-2+running-gear-1');
    expect(censusUnported(mesh.parent as THREE.Object3D)).toEqual([]);
  });
});

describe('Risk 2: one node build per twin, one GPU program per shape', () => {
  // three's `Pipelines` caches a GPU program by its CODE (`programs.vertex.get(nodeBuilderState.vertexShader)`), so twins of one
  // shape cost one node build each (CPU, once per twin) and share ONE vertex and ONE fragment program, iff their text is identical.
  it('the three team variants are three twins (each binds its own slot colour) with IDENTICAL GLSL and WGSL', async () => {
    const d = await unitDeps();
    const variants = new VehicleTeamMaterials(slotsOf());
    const base = laviMaterial();
    const meshes = [0, 1, 2].map((slot) => new THREE.Mesh(taggedGeometry(0), variants.materialFor(base, slot)));
    adoptAll(d, meshes);
    expect(new Set(meshes.map((m) => m.material)).size).toBe(3);
    const glsl = meshes.map((m) => compile(d, m, m.material as THREE.Material));
    expect(new Set(glsl.map((b) => b.vertex)).size).toBe(1);
    expect(new Set(glsl.map((b) => b.fragment)).size).toBe(1);
    const wgsl = meshes.map((m) => compileWgsl(d, m, m.material as THREE.Material));
    expect(new Set(wgsl.map((b) => b.vertex)).size).toBe(1);
    expect(new Set(wgsl.map((b) => b.fragment)).size).toBe(1);
  });

  it('two variants\' running-gear twins: identical WGSL (the G arm names each wheel array); GLSL names a uniform buffer by node id', async () => {
    const d = await unitDeps();
    const variants = new VehicleTeamMaterials(slotsOf());
    const base = laviMaterial();
    const meshes = [0, 1].map((slot) => {
      const mesh = new THREE.Mesh(taggedGeometry(1, 0.5), variants.materialFor(base, slot));
      bindRunningGear({ root: new THREE.Object3D().add(mesh), liveTop: [mesh] } as unknown as VehicleMeshEntity, SPEC);
      return mesh;
    });
    adoptAll(d, meshes);
    expect(meshes[0]?.material).not.toBe(meshes[1]?.material);
    const wgsl = meshes.map((m) => compileWgsl(d, m, m.material as THREE.Material));
    expect(wgsl[0]?.vertex).toContain('var<uniform> uRgRot : uRgRotStruct;');
    expect(wgsl[0]?.vertex).toBe(wgsl[1]?.vertex);
    expect(wgsl[0]?.fragment).toBe(wgsl[1]?.fragment);
    // The F arm (node on WebGL2, parity only: no F performance work, P1 ruling 2) compiles one program per twin here.
    const glsl = meshes.map((m) => compile(d, m, m.material as THREE.Material));
    expect(glsl[0]?.vertex).not.toBe(glsl[1]?.vertex);
    expect(glsl[0]?.vertex.replace(/(NodeBuffer_|buffer)\d+/g, '$1#')).toBe(glsl[1]?.vertex.replace(/(NodeBuffer_|buffer)\d+/g, '$1#'));
  });
});
