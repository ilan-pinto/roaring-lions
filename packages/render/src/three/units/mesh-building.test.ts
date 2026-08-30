import { describe, it, expect } from 'vitest';
import { parseRigidFixture } from './rigid-mesh-fixture';
import {
  buildBuildingMeshTemplate,
  instantiateBuildingMesh,
  disposeBuildingMeshTemplate,
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
    const template = buildBuildingMeshTemplate(gltf, 'limestone.1');
    expect(template.materials).toHaveLength(2);
    expect(template.geometries).toHaveLength(2);
    expect(template.root.scale.x).toBeCloseTo(MESH_SCALE);
  });

  it('a mosque and a house wall differ, from their own structures.json colour', async () => {
    const gltf = await parseRigidFixture({ parts: [{ nodeName: 'wall', extrasRole: 'wall' }] });
    const mosque = buildBuildingMeshTemplate(gltf, 'limestone.1');
    const house = buildBuildingMeshTemplate(gltf, 'limestone.3');
    const mat1 = mosque.materials[0] as import('three').ShaderMaterial;
    const mat2 = house.materials[0] as import('three').ShaderMaterial;
    expect(mat1.uniforms.uRamp.value).not.toEqual(mat2.uniforms.uRamp.value);
  });

  it('falls back to the node name when extras.rl_role is absent', async () => {
    const gltf = await parseRigidFixture({ parts: [{ nodeName: 'dome', extrasRole: null }] });
    const template = buildBuildingMeshTemplate(gltf, 'limestone.1');
    expect(template.materials).toHaveLength(1);
  });

  it('throws loudly for a role outside the building vocabulary', async () => {
    const gltf = await parseRigidFixture({ parts: [{ nodeName: 'uniform', extrasRole: 'uniform' }] });
    expect(() => buildBuildingMeshTemplate(gltf, 'limestone.1')).toThrow(/no ramp for rl_role/);
  });
});

describe('instantiateBuildingMesh', () => {
  it('produces independent clones sharing the template\'s materials by reference', async () => {
    const gltf = await parseRigidFixture({ parts: [{ nodeName: 'wall', extrasRole: 'wall' }] });
    const template = buildBuildingMeshTemplate(gltf, 'limestone.1');
    const a = instantiateBuildingMesh(template);
    const b = instantiateBuildingMesh(template);
    expect(a).not.toBe(b);
    a.position.set(1, 2, 3);
    expect(b.position.x).toBe(0);
    disposeBuildingMeshTemplate(template);
  });
});
