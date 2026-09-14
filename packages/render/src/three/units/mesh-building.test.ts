import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { parseRigidFixture } from './rigid-mesh-fixture';
import {
  buildBuildingMeshTemplate,
  instantiateBuildingMesh,
  disposeBuildingMeshTemplate,
  buildingSettleScale,
  BUILDING_SETTLE_SECONDS,
} from './mesh-building';
import { MESH_SCALE } from './mesh-anim';
import { liftTone } from '../world-materials';
import { rampForBuildingRole } from './building-mesh-role';

describe('buildBuildingMeshTemplate', () => {
  it('assigns one lit standard material per role, incl. the wall from its own colour key, shadows on', async () => {
    const gltf = await parseRigidFixture({
      parts: [
        { nodeName: 'wall', extrasRole: 'wall' },
        { nodeName: 'roof', extrasRole: 'roof' },
      ],
    });
    const template = buildBuildingMeshTemplate(gltf, 'limestone.1', 'flat');
    expect(template.materials).toHaveLength(2);
    expect(template.geometries).toHaveLength(2);
    expect(template.root.scale.x).toBeCloseTo(MESH_SCALE);

    const expectedHex: Record<string, string> = {
      wall: liftTone(rampForBuildingRole('wall', 'limestone.1')).slice(1).toUpperCase(),
      roof: liftTone(rampForBuildingRole('roof', 'limestone.1')).slice(1).toUpperCase(),
    };
    template.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const m = mesh.material as THREE.MeshStandardMaterial;
      expect(m.isMeshStandardMaterial).toBe(true);
      expect(m.color.getHexString().toUpperCase()).toBe(expectedHex[mesh.name]);
      expect(mesh.castShadow).toBe(true);
      expect(mesh.receiveShadow).toBe(true);
    });
  });

  it('a hall and a house wall differ, from their own structures.json colour', async () => {
    const gltf = await parseRigidFixture({ parts: [{ nodeName: 'wall', extrasRole: 'wall' }] });
    const hall = buildBuildingMeshTemplate(gltf, 'limestone.1', 'flat');
    const house = buildBuildingMeshTemplate(gltf, 'limestone.3', 'flat');
    const mat1 = hall.materials[0] as THREE.MeshStandardMaterial;
    const mat2 = house.materials[0] as THREE.MeshStandardMaterial;
    expect(mat1.color.getHexString()).not.toEqual(mat2.color.getHexString());
  });

  it('falls back to the node name when extras.rl_role is absent', async () => {
    const gltf = await parseRigidFixture({ parts: [{ nodeName: 'dome', extrasRole: null }] });
    const template = buildBuildingMeshTemplate(gltf, 'limestone.1', 'flat');
    expect(template.materials).toHaveLength(1);
  });

  it('throws loudly for a role outside the building vocabulary', async () => {
    const gltf = await parseRigidFixture({ parts: [{ nodeName: 'uniform', extrasRole: 'uniform' }] });
    expect(() => buildBuildingMeshTemplate(gltf, 'limestone.1', 'flat')).toThrow(/no ramp for rl_role/);
  });

  // Coursing (the brick/panel pattern the toon shader generated per-fragment
  // from a role's own ramp) had no lit-material equivalent as of the switch
  // to `rampMaterial` (`../world-materials.ts`) and is retired along with the
  // toon shader -- `wallSurface` stays a required parameter (every caller
  // still threads `wallSurfaceForBuilding(structureId)` through it) so a
  // future lit-coursing mechanism has somewhere to land, but it is currently
  // unread by this function. The wiring tests that used to live here
  // (`describe('coursing', ...)`) pinned a fragment-shader string that no
  // longer exists on any material this function builds.
});

describe('instantiateBuildingMesh', () => {
  it('produces independent clones sharing the template\'s materials by reference', async () => {
    const gltf = await parseRigidFixture({ parts: [{ nodeName: 'wall', extrasRole: 'wall' }] });
    const template = buildBuildingMeshTemplate(gltf, 'limestone.1', 'flat');
    const a = instantiateBuildingMesh(template);
    const b = instantiateBuildingMesh(template);
    expect(a).not.toBe(b);
    a.position.set(1, 2, 3);
    expect(b.position.x).toBe(0);
    disposeBuildingMeshTemplate(template);
  });
});

// GH #143 follow-up: `ThreeRenderer.updateBuildingMeshes` swaps a dying
// structure's idle mesh for its wreck one the instant `sim.alive` flips, with
// no transition of its own. `buildingSettleScale` is the pure timing half of
// a cheap, code-only fix -- a brief Y-axis grow-in for the newly-appeared
// wreck root -- kept separate from `ThreeRenderer` so the curve itself is
// provable in `environment: 'node'` with no scene/entity bookkeeping at all.
describe('buildingSettleScale', () => {
  it('starts below full scale -- a wreck that pops in at (1,1,1) has nothing left to settle', () => {
    expect(buildingSettleScale(0).scaleFactor).toBeLessThan(1);
    expect(buildingSettleScale(0).scaleFactor).toBeGreaterThan(0);
  });

  it('reaches exactly 1 at BUILDING_SETTLE_SECONDS and reports done', () => {
    const result = buildingSettleScale(BUILDING_SETTLE_SECONDS);
    expect(result.scaleFactor).toBe(1);
    expect(result.done).toBe(true);
  });

  it('is not done partway through, and monotonically increases toward 1', () => {
    const early = buildingSettleScale(BUILDING_SETTLE_SECONDS * 0.25);
    const mid = buildingSettleScale(BUILDING_SETTLE_SECONDS * 0.5);
    const late = buildingSettleScale(BUILDING_SETTLE_SECONDS * 0.9);
    expect(early.done).toBe(false);
    expect(mid.done).toBe(false);
    expect(late.done).toBe(false);
    expect(early.scaleFactor).toBeLessThan(mid.scaleFactor);
    expect(mid.scaleFactor).toBeLessThan(late.scaleFactor);
    expect(late.scaleFactor).toBeLessThan(1);
  });

  it('clamps past the settle duration rather than overshooting 1', () => {
    const result = buildingSettleScale(BUILDING_SETTLE_SECONDS * 5);
    expect(result.scaleFactor).toBe(1);
    expect(result.done).toBe(true);
  });
});
