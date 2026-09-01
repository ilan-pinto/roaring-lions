import { describe, it, expect } from 'vitest';
import { parseRigidFixture } from './rigid-mesh-fixture';
import {
  buildBuildingMeshTemplate,
  instantiateBuildingMesh,
  disposeBuildingMeshTemplate,
  buildingSettleScale,
  BUILDING_SETTLE_SECONDS,
} from './mesh-building';
import { MESH_SCALE } from './mesh-anim';

describe('buildBuildingMeshTemplate', () => {
  it('assigns one material per role, incl. the wall from its own colour key', async () => {
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
  });

  it('a mosque and a house wall differ, from their own structures.json colour', async () => {
    const gltf = await parseRigidFixture({ parts: [{ nodeName: 'wall', extrasRole: 'wall' }] });
    const mosque = buildBuildingMeshTemplate(gltf, 'limestone.1', 'flat');
    const house = buildBuildingMeshTemplate(gltf, 'limestone.3', 'flat');
    const mat1 = mosque.materials[0] as import('three').ShaderMaterial;
    const mat2 = house.materials[0] as import('three').ShaderMaterial;
    expect(mat1.uniforms.uRamp.value).not.toEqual(mat2.uniforms.uRamp.value);
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

  // The lead's complaint that started this: a mesh building drew one flat
  // colour per role while its own sprite has had coursed brick since the
  // building set shipped. Coursing is generated in the fragment shader and
  // selects a step of the role's OWN ramp, so it stays palette-exact --
  // `palette-material.coursing.test.ts` owns that half. These pin the
  // WIRING: which role, and which building type.
  describe('coursing', () => {
    async function wallAndRoof(surface: 'brick' | 'panel' | 'flat') {
      const gltf = await parseRigidFixture({
        parts: [
          { nodeName: 'wall', extrasRole: 'wall' },
          { nodeName: 'roof', extrasRole: 'roof' },
        ],
      });
      const t = buildBuildingMeshTemplate(gltf, 'limestone.1', surface);
      const [wall, roof] = t.materials as import('three').ShaderMaterial[];
      return { wall, roof };
    }

    it('courses the wall of a masonry building', async () => {
      const { wall } = await wallAndRoof('brick');
      expect(wall.fragmentShader).toContain('courseShiftSteps');
    });

    it('leaves every other role flat, even on a coursed building', async () => {
      // A coursed roof deck or a coursed dome is the exact failure
      // `render_building.py`'s `smooth_parts` exists to prevent.
      const { roof } = await wallAndRoof('brick');
      expect(roof.fragmentShader).not.toContain('courseShiftSteps');
    });

    it('leaves the wall flat for a type whose wall is not a laid material', async () => {
      const { wall } = await wallAndRoof('flat');
      expect(wall.fragmentShader).not.toContain('courseShiftSteps');
    });

    it('gives concrete a different pattern from masonry, not the same one', async () => {
      const brick = (await wallAndRoof('brick')).wall.fragmentShader;
      const panel = (await wallAndRoof('panel')).wall.fragmentShader;
      expect(panel).toContain('courseShiftSteps');
      expect(panel).not.toBe(brick);
    });
  });
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
