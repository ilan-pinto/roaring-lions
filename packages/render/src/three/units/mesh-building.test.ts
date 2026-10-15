import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { parseRigidFixture } from './rigid-mesh-fixture';
import {
  buildBuildingMeshTemplate,
  instantiateBuildingMesh,
  disposeBuildingMeshTemplate,
  buildingSettleScale,
  BUILDING_SETTLE_SECONDS,
  SELF_LIT_KEY,
  wallTreatmentOf,
} from './mesh-building';
import { MESH_SCALE } from './mesh-anim';
import { liftTone } from '../world-materials';
import { rampForBuildingRole, rampForWallTone } from './building-mesh-role';
import { Sim } from '@lions/sim';

type StructureTypeJson = Parameters<Sim['addStructureType']>[0];
import structuresJson from '../../../../../data/structures.json';

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

// #643: a north-south T-wall run read dark -- its camera face is the side the
// scene sun never reaches. The type now asks for an exact palette step
// (`wall_tone`) and a self-lit term (`wall_self_lit`) on its WALL role only.
describe('wall treatment (wall_tone, wall_self_lit)', () => {
  const structures = (structuresJson as unknown as { types: Record<string, StructureTypeJson> }).types;

  it('wall_tone draws the named step exactly, where the colour key draws the slice it starts lit', async () => {
    const gltf = await parseRigidFixture({ parts: [{ nodeName: 'wall', extrasRole: 'wall' }] });
    const keyed = buildBuildingMeshTemplate(gltf, 'gunmetal.0', 'panel');
    const toned = buildBuildingMeshTemplate(
      await parseRigidFixture({ parts: [{ nodeName: 'wall', extrasRole: 'wall' }] }),
      'gunmetal.0',
      'panel',
      false,
      { tone: 'gunmetal.0' }
    );
    // A literal oracle, not the module's own lookup: `gunmetal` is
    // #C3C7C4 / #8E9491 / #5C625F / #363B39 in data/palette.json.
    expect((keyed.materials[0] as THREE.MeshStandardMaterial).color.getHexString()).toBe('8e9491');
    expect((toned.materials[0] as THREE.MeshStandardMaterial).color.getHexString()).toBe('c3c7c4');
  });

  it('the self-lit term lands on the wall role and no other', async () => {
    const gltf = await parseRigidFixture({
      parts: [
        { nodeName: 'wall', extrasRole: 'wall' },
        { nodeName: 'metal', extrasRole: 'metal' },
        { nodeName: 'rust', extrasRole: 'rust' },
      ],
    });
    const template = buildBuildingMeshTemplate(gltf, 'gunmetal.0', 'panel', false, { tone: 'gunmetal.0', selfLit: 0.08 });
    const seen: string[] = [];
    template.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const m = mesh.material as THREE.MeshStandardMaterial;
      seen.push(mesh.name);
      if (mesh.name === 'wall') {
        expect(m.emissive.getHexString()).toBe(m.color.getHexString());
        expect(m.emissiveIntensity).toBeCloseTo(0.08, 9);
        expect(m.userData[SELF_LIT_KEY]).toBe(0.08);
      } else {
        expect(m.emissive.getHex()).toBe(0);
        expect(m.userData[SELF_LIT_KEY]).toBeUndefined();
        // and the tone never reaches another role either
        expect(m.color.getHexString()).not.toBe('c3c7c4');
      }
    });
    expect(seen.sort()).toEqual(['metal', 'rust', 'wall']);
  });

  it('a type that names neither gets the shipped wall: no tone, no glow', async () => {
    const gltf = await parseRigidFixture({ parts: [{ nodeName: 'wall', extrasRole: 'wall' }] });
    const m = buildBuildingMeshTemplate(gltf, 'limestone.3', 'brick', false, {}).materials[0] as THREE.MeshStandardMaterial;
    expect(m.color.getHexString()).toBe('b8a182');
    expect(m.emissive.getHex()).toBe(0);
  });

  it('rampForWallTone refuses a malformed key, an unknown band and a step past the band', () => {
    expect(rampForWallTone('gunmetal.3')).toEqual(['#363B39']);
    expect(() => rampForWallTone('gunmetal')).toThrow(/malformed/);
    expect(() => rampForWallTone('gunmetal.4')).toThrow(/4 steps/);
    expect(() => rampForWallTone('nope.0')).toThrow();
  });

  it('the shipped data reaches the renderer through the sim: the T-wall alone asks for a treatment', () => {
    const sim = new Sim({ seed: 1, width: 4, height: 4, capacity: 2 });
    for (const json of Object.values(structures)) sim.addStructureType(json);
    const asked = sim.structureTypes
      .map((t) => [t.id, wallTreatmentOf(t)] as const)
      .filter(([, w]) => Object.keys(w).length > 0);
    expect(asked).toEqual([['t_wall', { tone: 'gunmetal.0', selfLit: 0.08 }]]);
  });
});
