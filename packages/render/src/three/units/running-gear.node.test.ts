/**
 * @vitest-environment jsdom
 *
 * GH-943 P3 (T3) gates for the running-gear terms of the node unit twin (`running-gear.node.ts`), built by the backend's own
 * factory body from REAL running-gear clones (`bindRunningGear` on two vehicles of one template), adopted through the real
 * memo, and compiled by three's `GLSLNodeBuilder`. Oracles are LITERALS. Each gate has a one-line falsification, run by hand and
 * listed in the commit message:
 *  - G4 the rotation on numbers: rotate about the origin instead of the axle (`d = p` in `rgVertexOps`);
 *  - G5 the shadow keeps the rest pose: drop `twin.castShadowPositionNode`; the AO pre-pass keeps it: delete the composer's
 *    `builder.material` guard;
 *  - G6 per-object values reach each draw: make `objectArray` material-scoped (`onRenderUpdate` reading the first legacy user);
 *  - the tread on numbers: drop the `- RG_TREAD_DUTY` (mean preservation) in `rgBarOps`.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { NUMBER_OPS } from '../fog-ops';
import { RG_TREAD_DEPTH, RG_TREAD_DUTY, parseRunningGear, rgBarOps, rgNormalOps, rgPhaseOps, rgVertexOps, type RunningGearSpec } from './running-gear';
import { RG_PROGRAM_KEY, runningGearUniformsOf } from './running-gear-material';
import { bindRunningGear, runningGearBinding } from './running-gear-binding';
import type { VehicleMeshEntity } from './mesh-vehicle';
import { adoptUnits, bindingsOf, compile, laviMaterial, mainOf, runUpdate, taggedGeometry, uniformOf, unitDeps, type UnitDeps } from './unit-twin.test-support';

const SPEC = parseRunningGear(
  {
    rl_running_gear: {
      version: 1,
      wheels: [
        { side: 'r', index: 0, centre: [0, 0.4, 1], radius: 0.4, cutRadius: 0.41, steer: false, maxSteerRad: 0 },
        { side: 'l', index: 0, centre: [0, 0.4, -1], radius: 0.4, cutRadius: 0.41, steer: false, maxSteerRad: 0 },
      ],
      tracks: [{ side: 'r', loopLength: 6, pitch: 0.2, gauge: 1 }],
    },
  },
  'fixture'
) as RunningGearSpec;

describe('G4: the wheel rotation on numbers (NUMBER_OPS)', () => {
  it('a quarter turn about an axle at (0, 0.4, 1) carries (0.5, 0.4, 1) to (0, 0.9, 1)', () => {
    const q: [number, number, number, number] = [0, 1, 1, 0]; // cos 90, sin 90, no steer
    const out = rgVertexOps(NUMBER_OPS, [0.5, 0.4, 1], [0, 0.4, 1], q, 1);
    expect(out[0]).toBeCloseTo(0, 12);
    expect(out[1]).toBeCloseTo(0.9, 12);
    expect(out[2]).toBeCloseTo(1, 12);
  });

  it('leaves the rest pose untouched: _rl_wheel 0 returns p bit for bit whatever the rotation, and the rest rotation does too', () => {
    const p: [number, number, number] = [1.6123456789, 0.123456789, 0.987654321];
    expect(rgVertexOps(NUMBER_OPS, p, [0, 0.4, 1], [0, 1, 1, 0], 0)).toEqual(p);
    expect(rgVertexOps(NUMBER_OPS, p, [1.6, 0.43, 0.94], [1, 0, 1, 0], 1)).toEqual(p);
    expect(rgNormalOps(NUMBER_OPS, [0, 1, 0], [0, 1, 1, 0], 0)).toEqual([0, 1, 0]);
    // The normal turns with the wheel: up becomes -x at a quarter turn.
    const n = rgNormalOps(NUMBER_OPS, [0, 1, 0], [0, 1, 1, 0], 1);
    expect(n[0]).toBeCloseTo(-1, 12);
    expect(n[1]).toBeCloseTo(0, 12);
  });

  it('the tread: a bar centre at full strength darkens by depth x (1 - duty); off the track the factor is exactly 1', () => {
    // phase 0.1 inside a bar, rate 0.01: the box filter reads a full bar (1), fade 1.
    expect(rgBarOps(NUMBER_OPS, 0.1, 0.01, 0, 1)).toBeCloseTo(1 - 0.35 * (1 - 0.35), 12);
    expect(RG_TREAD_DEPTH).toBe(0.35);
    expect(RG_TREAD_DUTY).toBe(0.35);
    // Between bars it lightens (mean-preserving): 1 + depth x duty.
    expect(rgBarOps(NUMBER_OPS, 0.6, 0.01, 0, 1)).toBeCloseTo(1 + 0.35 * 0.35, 12);
    expect(rgBarOps(NUMBER_OPS, 0.1, 0.01, -1, 1)).toBe(1);
    expect(rgBarOps(NUMBER_OPS, 0.1, 0.01, 0, 0)).toBe(1);
    // The phase: right side (z >= 0) reads the right pitch and phase.
    expect(rgPhaseOps(NUMBER_OPS, 2, 0.5, [5, 3], [0.25, 0.75])).toBe(2 * 5 - 0.25);
    expect(rgPhaseOps(NUMBER_OPS, 2, -0.5, [5, 3], [0.25, 0.75])).toBe(2 * 3 - 0.75);
  });
});

/** Two live vehicles of one template, both bound (each gets its own running-gear clone of the template material). */
function twoVehicles(): { meshes: [THREE.Mesh, THREE.Mesh]; entities: [VehicleMeshEntity, VehicleMeshEntity]; base: THREE.MeshStandardMaterial } {
  const base = laviMaterial();
  base.userData = {};
  const make = (): { mesh: THREE.Mesh; entity: VehicleMeshEntity } => {
    const root = new THREE.Object3D();
    const mesh = new THREE.Mesh(taggedGeometry(1, 0.5), base);
    root.add(mesh);
    const entity = { root, liveTop: [mesh] } as unknown as VehicleMeshEntity;
    if (bindRunningGear(entity, SPEC) === null) throw new Error('spec: nothing tagged');
    return { mesh, entity };
  };
  const a = make();
  const b = make();
  return { meshes: [a.mesh, b.mesh], entities: [a.entity, b.entity], base };
}

async function adopted(d: UnitDeps): Promise<ReturnType<typeof twoVehicles> & { twin: THREE.Material }> {
  const v = twoVehicles();
  const scene = new THREE.Scene();
  scene.add(v.entities[0].root, v.entities[1].root);
  adoptUnits(d, scene);
  const twin = v.meshes[0].material as THREE.Material;
  // Built once, as the renderer would before any update runs (a uniform array allocates its buffer at build).
  compile(d, v.meshes[0], twin);
  return { ...v, twin };
}

describe('G6: one twin for every vehicle of a template, and each draw reads its own wheels', () => {
  it('two bound vehicles share one twin; the object update run with each reads THAT vehicle\'s uRgRot and uRgTrack', async () => {
    const d = await unitDeps();
    const v = await adopted(d);
    expect(v.meshes[1].material).toBe(v.twin);
    expect(bindingsOf(v.twin).applied).toEqual([RG_PROGRAM_KEY]);
    const ua = runningGearBinding(v.entities[0])?.uniforms[0];
    const ub = runningGearBinding(v.entities[1])?.uniforms[0];
    if (ua === undefined || ub === undefined) throw new Error('spec: unbound');
    expect(ua).not.toBe(ub);
    // Literal, different wheel angles and tread phases per vehicle (what `writeRunningGearUniforms` writes every frame).
    ua.uRgRot.value[0].set(0, 1, 1, 0);
    ub.uRgRot.value[0].set(-1, 0, 1, 0);
    ua.uRgTrack.value.set(0.1, 0.2, 1, 0);
    ub.uRgTrack.value.set(0.7, 0.8, 0.5, 0);
    const rot = uniformOf(v.twin, 'uRgRot');
    const track = uniformOf(v.twin, 'uRgTrack');
    runUpdate(rot, v.meshes[0]);
    runUpdate(track, v.meshes[0]);
    expect((rot.array as THREE.Vector4[])[0].toArray()).toEqual([0, 1, 1, 0]);
    expect((rot.value as Float32Array).subarray(0, 4)).toEqual(new Float32Array([0, 1, 1, 0]));
    expect((track.value as THREE.Vector4).toArray()).toEqual([0.1, 0.2, 1, 0]);
    runUpdate(rot, v.meshes[1]);
    runUpdate(track, v.meshes[1]);
    expect((rot.array as THREE.Vector4[])[0].toArray()).toEqual([-1, 0, 1, 0]);
    expect((rot.value as Float32Array).subarray(0, 4)).toEqual(new Float32Array([-1, 0, 1, 0]));
    expect((track.value as THREE.Vector4).toArray()).toEqual([0.7, 0.8, 0.5, 0]);
    // The objects are the clones' own (the very ones the legacy splice binds), never copies.
    expect(runningGearUniformsOf(v.meshes[0].userData.rlLegacy as THREE.Material)).toBe(ua);
  });

  it('the axle and the pitch are per object too, and every running-gear uniform is in the object group of the program', async () => {
    const d = await unitDeps();
    const v = await adopted(d);
    const built = compile(d, v.meshes[0], v.twin);
    for (const name of ['uRgRot', 'uRgAxle']) expect(built.usedVertex.has(uniformOf(v.twin, name)), `${name} not in the vertex program`).toBe(true);
    for (const name of ['uRgTrack', 'uRgPitchInv']) expect(built.usedFragment.has(uniformOf(v.twin, name)), `${name} not in the fragment program`).toBe(true);
    const axle = uniformOf(v.twin, 'uRgAxle');
    runUpdate(axle, v.meshes[1]);
    expect((axle.array as THREE.Vector4[])[0].toArray()).toEqual([0, 0.4, 1, 0]);
    expect((axle.array as THREE.Vector4[])[1].toArray()).toEqual([0, 0.4, -1, 0]);
    const pitch = uniformOf(v.twin, 'uRgPitchInv');
    runUpdate(pitch, v.meshes[1]);
    expect((pitch.value as THREE.Vector2).toArray()).toEqual([5, 0]);
    for (const name of ['uRgRot', 'uRgAxle', 'uRgTrack', 'uRgPitchInv']) {
      expect((uniformOf(v.twin, name) as unknown as { updateType: string }).updateType, name).toBe('object');
    }
  });
});

describe('the vertex program: the position and the normal turn about the axle', () => {
  it('reads _rl_wheel, uRgRot and uRgAxle, writes normalLocal from the turned normal BEFORE the view normal, and the position after it', async () => {
    const d = await unitDeps();
    const v = await adopted(d);
    const vert = mainOf(compile(d, v.meshes[0], v.twin).vertex);
    expect(vert).toMatch(/rlRgWheel = max\( \( int\( \( float\( _rl_wheel \) \+ 0\.5 \) \) - 1 \), 0 \);/);
    const normal = vert.indexOf('normalLocal = vec3(');
    const view = vert.indexOf('v_normalViewGeometry =');
    const position = vert.indexOf('positionLocal = vec3(');
    expect(normal).toBeGreaterThan(0);
    expect(view).toBeGreaterThan(normal);
    expect(position).toBeGreaterThan(normal);
    // The position reads the axle (`p - centre`), the normal does not.
    expect(vert).toMatch(/positionLocal\.x - rlRgAxle\.x/);
    expect(vert.slice(0, normal)).not.toContain('rlRgAxle');
  });

  it('the fragment reads _rl_track and the geometry z for the tread, before the mark', async () => {
    const d = await unitDeps();
    const v = await adopted(d);
    const frag = mainOf(compile(d, v.meshes[0], v.twin).fragment);
    expect(frag).toMatch(/rlRgPhase = \( \( \w+ \* mix\( uRgPitchInv\.y, uRgPitchInv\.x, \w+ \) \) - mix\( uRgTrack\.y, uRgTrack\.x, \w+ \) \);/);
    expect(frag).toMatch(/max\( fwidth\( rlRgPhase \), 0\.0001 \)/);
    expect(frag).toContain('rlUnitColorTread = vec4( ( rlUnitColorMap.xyz *');
  });
});

describe('G5: the shadow and the AO pre-pass keep the rest pose', () => {
  it('the shadow program (castShadowPositionNode, three\'s own shadow-node choice) carries no uRgRot', async () => {
    const d = await unitDeps();
    const v = await adopted(d);
    expect(mainOf(compile(d, v.meshes[0], v.twin).vertex)).toContain('rlRgRot'); // anti-vacuity
    const shadow = new d.W.NodeMaterial() as unknown as THREE.Material & { isShadowPassMaterial: boolean; positionNode: unknown; fragmentNode: unknown };
    shadow.isShadowPassMaterial = true;
    // A depth pass: what it writes is not the question, which position it draws is.
    shadow.fragmentNode = d.TSL.vec4(0, 0, 0, 1);
    shadow.positionNode = (v.twin as unknown as { positionNode: unknown }).positionNode;
    const renderer = (await import('./unit-twin.test-support')).builderRenderer(d);
    const picked = (renderer as unknown as { _getShadowNodes(m: THREE.Material): { positionNode: unknown } })._getShadowNodes(v.twin);
    if (picked.positionNode !== null) shadow.positionNode = picked.positionNode;
    const built = compile(d, v.meshes[0], shadow);
    expect(built.vertex).not.toContain('rlRgRot');
    expect(built.usedVertex.has(uniformOf(v.twin, 'uRgRot'))).toBe(false);
  });

  it('an override pass three hands positionNode to (the node AO pre-pass\'s normal material) draws the rest pose', async () => {
    const d = await unitDeps();
    const v = await adopted(d);
    const normal = new d.W.NodeMaterial() as THREE.Material & { fragmentNode: unknown; positionNode: unknown };
    normal.name = 'rl-node-ao-normal';
    normal.fragmentNode = d.TSL.vec4(d.TSL.normalView, 1);
    normal.positionNode = (v.twin as unknown as { positionNode: unknown }).positionNode;
    const built = compile(d, v.meshes[0], normal);
    expect(built.vertex).not.toContain('rlRgRot');
    expect(built.vertex).not.toContain('_rl_wheel');
  });
});
