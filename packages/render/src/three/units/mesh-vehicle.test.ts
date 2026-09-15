import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { parseRigidFixture } from './rigid-mesh-fixture';
import {
  buildVehicleMeshTemplate,
  instantiateVehicleMesh,
  disposeVehicleMeshEntity,
  disposeVehicleMeshTemplate,
  VEHICLE_DEATH_ROOT_NAME,
} from './mesh-vehicle';
import { applyMeshClip } from './mesh-clip';
import { MESH_SCALE } from './mesh-anim';
import { HULL_RENDER_ORDER, TURRET_RENDER_ORDER } from './render-order';
import { liftTone } from '../world-materials';
import { rampForVehicleRole } from './vehicle-mesh-role';

describe('buildVehicleMeshTemplate', () => {
  it('assigns one lit standard material per mesh, from the vehicle-specific ramp table, shadows on', async () => {
    const gltf = await parseRigidFixture({
      parts: [
        { nodeName: 'hull_hull', extrasRole: 'hull' },
        { nodeName: 'turret_hull', extrasRole: 'hull' },
      ],
      pivot: { pivotName: 'turret_pivot', pivotChildren: [1] },
    });
    const template = buildVehicleMeshTemplate(gltf, 'mbt_lavi');
    expect(template.materials).toHaveLength(2);
    // ONE geometry, not two, and this changed on 2026-09-15: `geometries` is
    // deduped by object identity now, because the wreck pass gives a
    // `WRECK_` node and its live twin the same glTF mesh and disposing one
    // `BufferGeometry` twice is a real bug. This fixture reuses a single
    // accessor set across every part, which `GLTFLoader` caches, so its two
    // meshes have always shared one geometry -- the old `toHaveLength(2)`
    // was counting pushes, not objects. A real vehicle GLB, whose parts
    // carry their own accessors, is unaffected either way.
    expect(template.geometries).toHaveLength(1);
    expect(template.hasTurretPivot).toBe(true);
    expect(template.root.scale.x).toBeCloseTo(MESH_SCALE);

    const expectedHex = liftTone(rampForVehicleRole('mbt_lavi', 'hull')).slice(1).toUpperCase();
    template.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const m = mesh.material as THREE.MeshStandardMaterial;
      expect(m.isMeshStandardMaterial).toBe(true);
      expect(m.color.getHexString().toUpperCase()).toBe(expectedHex);
      expect(mesh.castShadow).toBe(true);
      expect(mesh.receiveShadow).toBe(true);
    });
  });

  it('sets render order by the {part}_ prefix, not by role', async () => {
    const gltf = await parseRigidFixture({
      parts: [
        { nodeName: 'hull_metal', extrasRole: 'metal' },
        { nodeName: 'turret_metal', extrasRole: 'metal' },
      ],
      pivot: { pivotName: 'turret_pivot', pivotChildren: [1] },
    });
    const template = buildVehicleMeshTemplate(gltf, 'apc_eitan');
    const orders: number[] = [];
    template.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) orders.push(mesh.renderOrder);
    });
    expect(orders).toEqual(expect.arrayContaining([HULL_RENDER_ORDER, TURRET_RENDER_ORDER]));
    expect(orders).toHaveLength(2);
  });

  it('has no turret pivot for a hull-only vehicle (dozer_d9)', async () => {
    const gltf = await parseRigidFixture({
      parts: [{ nodeName: 'hull_hull', extrasRole: 'hull' }],
    });
    const template = buildVehicleMeshTemplate(gltf, 'dozer_d9');
    expect(template.hasTurretPivot).toBe(false);
  });

  it('falls back to the node name when extras.rl_role is absent', async () => {
    const gltf = await parseRigidFixture({
      parts: [{ nodeName: 'hull', extrasRole: null }],
    });
    const template = buildVehicleMeshTemplate(gltf, 'mbt_lavi');
    expect(template.materials).toHaveLength(1);
  });

  it('throws loudly for a role outside the vehicle vocabulary', async () => {
    const gltf = await parseRigidFixture({
      parts: [{ nodeName: 'hull_uniform', extrasRole: 'uniform' }],
    });
    expect(() => buildVehicleMeshTemplate(gltf, 'mbt_lavi')).toThrow(/no ramp for rl_role/);
  });

  it('throws loudly for an unknown vehicle id', async () => {
    const gltf = await parseRigidFixture({ parts: [{ nodeName: 'hull_hull', extrasRole: 'hull' }] });
    expect(() => buildVehicleMeshTemplate(gltf, 'gun_truck')).toThrow(/no ramp table/);
  });
});

describe('instantiateVehicleMesh', () => {
  it('finds the clone\'s own turret_pivot node, distinct from the template\'s', async () => {
    const gltf = await parseRigidFixture({
      parts: [
        { nodeName: 'hull_hull', extrasRole: 'hull' },
        { nodeName: 'turret_hull', extrasRole: 'hull' },
      ],
      pivot: { pivotName: 'turret_pivot', pivotChildren: [1] },
    });
    const template = buildVehicleMeshTemplate(gltf, 'mbt_lavi');
    const a = instantiateVehicleMesh(template, 'mbt_lavi');
    const b = instantiateVehicleMesh(template, 'mbt_lavi');
    expect(a.turretPivot).not.toBeNull();
    expect(b.turretPivot).not.toBeNull();
    expect(a.turretPivot).not.toBe(b.turretPivot);
    expect(a.root).not.toBe(b.root);
    disposeVehicleMeshTemplate(template);
  });

  it('rotating one clone\'s pivot does not move the other', async () => {
    const gltf = await parseRigidFixture({
      parts: [
        { nodeName: 'hull_hull', extrasRole: 'hull' },
        { nodeName: 'turret_hull', extrasRole: 'hull' },
      ],
      pivot: { pivotName: 'turret_pivot', pivotChildren: [1] },
    });
    const template = buildVehicleMeshTemplate(gltf, 'mbt_lavi');
    const a = instantiateVehicleMesh(template, 'mbt_lavi');
    const b = instantiateVehicleMesh(template, 'mbt_lavi');
    a.turretPivot!.rotation.y = 1.23;
    expect(b.turretPivot!.rotation.y).toBe(0);
  });

  it('has a null turretPivot for a vehicle with none', async () => {
    const gltf = await parseRigidFixture({ parts: [{ nodeName: 'hull_hull', extrasRole: 'hull' }] });
    const template = buildVehicleMeshTemplate(gltf, 'dozer_d9');
    const entity = instantiateVehicleMesh(template, 'dozer_d9');
    expect(entity.turretPivot).toBeNull();
  });
});

// --- Animation: the vehicle half of the mixer/clip path infantry has had
// --- since `mesh-unit.ts` shipped. Every shipped `art/meshes/vehicles/*.glb`
// --- declares ZERO animations today, so both halves matter equally: that a
// --- clipped GLB plays, and that a clipless one is untouched.

describe('buildVehicleMeshTemplate clips', () => {
  it('collects every authored clip, keyed by name', async () => {
    const gltf = await parseRigidFixture({
      parts: [{ nodeName: 'hull_hull', extrasRole: 'hull' }],
      clipNames: ['idle', 'move', 'work'],
    });
    const template = buildVehicleMeshTemplate(gltf, 'dozer_d9');
    expect([...template.clips.keys()].sort()).toEqual(['idle', 'move', 'work']);
  });

  it('yields an empty clip map for a GLB with no animations -- every shipped vehicle today', async () => {
    const gltf = await parseRigidFixture({ parts: [{ nodeName: 'hull_hull', extrasRole: 'hull' }] });
    const template = buildVehicleMeshTemplate(gltf, 'dozer_d9');
    expect(template.clips.size).toBe(0);
  });

  it('throws loudly for a clip name outside the contract vocabulary', async () => {
    const gltf = await parseRigidFixture({
      parts: [{ nodeName: 'hull_hull', extrasRole: 'hull' }],
      clipNames: ['tracks_roll'],
    });
    expect(() => buildVehicleMeshTemplate(gltf, 'dozer_d9')).toThrow(/not a recognised clip name/);
  });
});

describe('instantiateVehicleMesh mixer', () => {
  it('builds one mixer and one action per clip when the GLB carries clips', async () => {
    const gltf = await parseRigidFixture({
      parts: [{ nodeName: 'hull_hull', extrasRole: 'hull' }],
      clipNames: ['idle', 'work'],
    });
    const template = buildVehicleMeshTemplate(gltf, 'dozer_d9');
    const entity = instantiateVehicleMesh(template, 'dozer_d9');
    expect(entity.mixer).not.toBeNull();
    expect([...entity.actions.keys()].sort()).toEqual(['idle', 'work']);
    expect(entity.currentClip).toBeNull();
  });

  it('allocates NO mixer and NO actions for a clipless GLB -- the regression that matters', async () => {
    const gltf = await parseRigidFixture({ parts: [{ nodeName: 'hull_hull', extrasRole: 'hull' }] });
    const template = buildVehicleMeshTemplate(gltf, 'dozer_d9');
    const entity = instantiateVehicleMesh(template, 'dozer_d9');
    expect(entity.mixer).toBeNull();
    expect(entity.actions.size).toBe(0);
  });

  it('actually deforms the clone, and moves ONLY the part the selected clip drives', async () => {
    // Two parts, two clips: `rigid-mesh-fixture.ts` points clip N at part N,
    // so which node moved is a direct read of which clip `applyMeshClip`
    // chose. A fixture where both clips share one sampler could not tell
    // `work` from `idle` at all.
    const gltf = await parseRigidFixture({
      parts: [
        { nodeName: 'hull_hull', extrasRole: 'hull' },
        { nodeName: 'hull_metal', extrasRole: 'metal' },
      ],
      clipNames: ['idle', 'work'],
    });
    const template = buildVehicleMeshTemplate(gltf, 'dozer_d9');
    const entity = instantiateVehicleMesh(template, 'dozer_d9');
    const part = (name: string): THREE.Object3D => {
      const found = entity.root.getObjectByName(name);
      if (!found) throw new Error(`fixture part node ${name} missing`);
      return found;
    };

    applyMeshClip(entity, 'work'); // clip index 1 -> node index 1
    entity.mixer?.update(0.5);
    expect(part('hull_metal').quaternion.x).toBeGreaterThan(0.1);
    expect(part('hull_hull').quaternion.x).toBeCloseTo(0, 5);
  });

  it('two clones animate independently -- one mixer each, not a shared one', async () => {
    const gltf = await parseRigidFixture({
      parts: [{ nodeName: 'hull_hull', extrasRole: 'hull' }],
      clipNames: ['move'],
    });
    const template = buildVehicleMeshTemplate(gltf, 'dozer_d9');
    const a = instantiateVehicleMesh(template, 'dozer_d9');
    const b = instantiateVehicleMesh(template, 'dozer_d9');
    expect(a.mixer).not.toBe(b.mixer);
    applyMeshClip(a, 'move');
    a.mixer?.update(0.5);
    const nodeA = a.root.getObjectByName('hull_hull');
    const nodeB = b.root.getObjectByName('hull_hull');
    expect(nodeA?.quaternion.x).toBeGreaterThan(0.1);
    expect(nodeB?.quaternion.x).toBeCloseTo(0, 5);
  });

  it('a clipless entity is inert under applyMeshClip -- no clip latches, nothing moves', async () => {
    const gltf = await parseRigidFixture({ parts: [{ nodeName: 'hull_hull', extrasRole: 'hull' }] });
    const template = buildVehicleMeshTemplate(gltf, 'dozer_d9');
    const entity = instantiateVehicleMesh(template, 'dozer_d9');
    const node = entity.root.getObjectByName('hull_hull');
    const before = node?.quaternion.clone();
    applyMeshClip(entity, 'work');
    expect(entity.currentClip).toBeNull();
    expect(node?.quaternion.x).toBeCloseTo(before?.x ?? 0, 6);
    expect(node?.quaternion.w).toBeCloseTo(before?.w ?? 1, 6);
  });
});

describe('disposeVehicleMeshEntity', () => {
  it('stops every action and uncaches the root', async () => {
    const gltf = await parseRigidFixture({
      parts: [{ nodeName: 'hull_hull', extrasRole: 'hull' }],
      clipNames: ['idle', 'move'],
    });
    const template = buildVehicleMeshTemplate(gltf, 'dozer_d9');
    const entity = instantiateVehicleMesh(template, 'dozer_d9');
    applyMeshClip(entity, 'move');
    const action = entity.actions.get('move');
    expect(action?.isRunning()).toBe(true);
    disposeVehicleMeshEntity(entity);
    expect(action?.isRunning()).toBe(false);
    // `uncacheRoot` drops the mixer's binding for this root entirely, so a
    // further `update` can never revive the clone -- mirrors
    // `disposeMeshUnitEntity`'s own contract.
    expect(entity.mixer?.existingAction(template.clips.get('move') as THREE.AnimationClip)).toBeNull();
  });

  it('is a safe no-op for a clipless entity -- every shipped vehicle today', async () => {
    const gltf = await parseRigidFixture({ parts: [{ nodeName: 'hull_hull', extrasRole: 'hull' }] });
    const template = buildVehicleMeshTemplate(gltf, 'dozer_d9');
    const entity = instantiateVehicleMesh(template, 'dozer_d9');
    expect(() => disposeVehicleMeshEntity(entity)).not.toThrow();
  });
});

/**
 * The FIXTURE's own `deathRoot` option, checked against the asset contract it
 * stands in for (spec §4.1) rather than against the runtime that consumes it
 * -- if the fixture drifts from what `tools/src/meshes/wreck-pass.ts` writes,
 * every test built on it is measuring the wrong asset.
 */
describe('rigid-mesh-fixture deathRoot', () => {
  it('parses through the real GLTFLoader with the contract shape: shared meshes, twin extras, rl_wreck', async () => {
    const gltf = await parseRigidFixture({
      parts: [
        { nodeName: 'hull_hull', extrasRole: 'hull' },
        { nodeName: 'turret_metal', extrasRole: 'metal' },
      ],
      clipNames: ['idle', 'wreck'],
      deathRoot: { parts: ['hull_hull', 'turret_metal'] },
    });

    const deathRoot = gltf.scene.getObjectByName(VEHICLE_DEATH_ROOT_NAME);
    expect(deathRoot).toBeDefined();
    expect(deathRoot?.children.map((c) => c.name)).toEqual(['WRECK_hull_hull', 'WRECK_turret_metal']);

    const live = gltf.scene.getObjectByName('hull_hull') as THREE.Mesh;
    const wreck = gltf.scene.getObjectByName('WRECK_hull_hull') as THREE.Mesh;
    // The whole point of the pass: a node, not a buffer.
    expect(wreck.geometry).toBe(live.geometry);
    expect(wreck.userData.rl_wreck).toBe(true);
    expect(wreck.userData.rl_role).toBe('hull');
    expect(live.userData.rl_wreck).toBeUndefined();
    // A displacement of its own, so a wreck copy is never merely its twin.
    expect(wreck.position.y).not.toBe(live.position.y);
  });

  it('emits the two clips as constant STEP scale channels over every live root and the death root', async () => {
    const gltf = await parseRigidFixture({
      parts: [
        { nodeName: 'hull_hull', extrasRole: 'hull' },
        { nodeName: 'turret_metal', extrasRole: 'metal' },
      ],
      clipNames: ['idle', 'wreck'],
      deathRoot: { parts: ['hull_hull', 'turret_metal'] },
    });

    const names = gltf.animations.map((c) => c.name).sort();
    expect(names).toEqual(['idle', 'wreck']);
    for (const clip of gltf.animations) {
      // Live top-level roots + the death root: 2 + 1 here.
      expect(clip.tracks).toHaveLength(3);
      for (const track of clip.tracks) {
        expect(track.name.endsWith('.scale')).toBe(true);
        expect(track.getInterpolation()).toBe(THREE.InterpolateDiscrete);
        // Constant across the clip -- a held pose, never a transition.
        const half = track.values.length / 2;
        expect([...track.values].slice(0, half)).toEqual([...track.values].slice(half));
      }
    }

    // And the sense of it: idle shows the live body, wreck shows the wreck.
    const trackFor = (clipName: string, node: string) => {
      const clip = gltf.animations.find((c) => c.name === clipName);
      return clip?.tracks.find((t) => t.name === `${node}.scale`);
    };
    expect(trackFor('idle', 'hull_hull')?.values[0]).toBe(1);
    expect(trackFor('idle', VEHICLE_DEATH_ROOT_NAME)?.values[0]).toBe(0);
    expect(trackFor('wreck', 'hull_hull')?.values[0]).toBe(0);
    expect(trackFor('wreck', VEHICLE_DEATH_ROOT_NAME)?.values[0]).toBe(1);
  });

  it('emits the nodes but NO clips when the pair is not asked for -- a legal, hasWreck-false shape', async () => {
    const gltf = await parseRigidFixture({
      parts: [{ nodeName: 'hull_hull', extrasRole: 'hull' }],
      deathRoot: { parts: ['hull_hull'] },
    });
    expect(gltf.scene.getObjectByName(VEHICLE_DEATH_ROOT_NAME)).toBeDefined();
    expect(gltf.animations).toHaveLength(0);
  });

  it('refuses a deathRoot naming a part that does not exist', async () => {
    await expect(
      parseRigidFixture({ parts: [{ nodeName: 'hull_hull' }], deathRoot: { parts: ['nope'] } })
    ).rejects.toThrow(/not one of the parts/);
  });
});
