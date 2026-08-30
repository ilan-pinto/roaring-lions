import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { parseRigidFixture } from './rigid-mesh-fixture';
import {
  buildVehicleMeshTemplate,
  instantiateVehicleMesh,
  disposeVehicleMeshTemplate,
} from './mesh-vehicle';
import { MESH_SCALE } from './mesh-anim';
import { HULL_RENDER_ORDER, TURRET_RENDER_ORDER } from './render-order';

describe('buildVehicleMeshTemplate', () => {
  it('assigns one material per mesh, from the vehicle-specific ramp table', async () => {
    const gltf = await parseRigidFixture({
      parts: [
        { nodeName: 'hull_hull', extrasRole: 'hull' },
        { nodeName: 'turret_hull', extrasRole: 'hull' },
      ],
      pivot: { pivotName: 'turret_pivot', pivotChildren: [1] },
    });
    const template = buildVehicleMeshTemplate(gltf, 'mbt_lavi');
    expect(template.materials).toHaveLength(2);
    expect(template.geometries).toHaveLength(2);
    expect(template.hasTurretPivot).toBe(true);
    expect(template.root.scale.x).toBeCloseTo(MESH_SCALE);
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
