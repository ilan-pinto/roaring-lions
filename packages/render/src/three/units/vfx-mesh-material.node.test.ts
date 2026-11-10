/**
 * @vitest-environment jsdom
 *
 * GH-943 P3 (T11) gates for `vfx-mesh-material.node.ts`: the flat-colour FX mesh (muzzle flash, explosion burst, collapse flash).
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createVfxMeshMaterial, VFX_MESH_MATERIAL_NAME } from './vfx-mesh-material';
import { NODE_VFX_MESH_NAME } from './vfx-mesh-material.node';
import { FX_BOUND_KEY, type FxTwinBound } from './fx.node';
import { adoptFx, compileFx } from './fx-twin-test-kit';

const meshOf = (): { mesh: THREE.InstancedMesh; legacy: THREE.ShaderMaterial } => {
  const legacy = createVfxMeshMaterial();
  return { mesh: new THREE.InstancedMesh(new THREE.BoxGeometry(), legacy, 2), legacy };
};

describe('the flat-colour FX mesh twin', () => {
  it('names the legacy material the way the legacy factory spells it', () => {
    expect(VFX_MESH_MATERIAL_NAME).toBe('rl-fx-mesh');
    expect(createVfxMeshMaterial().name).toBe('rl-fx-mesh');
  });

  it('draws one flat uColor with alpha 1: the colour reaches the program, there is no alpha input, and no lighting', async () => {
    const { mesh } = meshOf();
    const twin = await adoptFx(mesh);
    const c = await compileFx(mesh);
    const bound = twin.userData[FX_BOUND_KEY] as FxTwinBound;
    expect(c.uniforms.has(bound.uColor)).toBe(true);
    expect(c.fragment).toMatch(/DiffuseColor = vec4\( nodeUniform\d+, 1\.0 \);/);
    expect((twin as THREE.Material & { opacityNode: unknown }).opacityNode).toBeNull();
    expect(c.vertex).not.toMatch(/\bin vec[234] (a[A-Z]\w*)/);
    expect(c.frameClocked).toEqual([]);
    expect(twin.name).toBe(NODE_VFX_MESH_NAME);
  });

  it('the legacy colour is shared by reference: a write into the legacy Color (what `setColors` does) is the twin\'s colour', async () => {
    const { mesh, legacy } = meshOf();
    const twin = await adoptFx(mesh);
    const node = (twin.userData[FX_BOUND_KEY] as FxTwinBound).uColor as unknown as { value: THREE.Color };
    expect(node.value).toBe(legacy.uniforms.uColor!.value);
    (legacy.uniforms.uColor!.value as THREE.Color).setRGB(4, 2, 1);
    expect([node.value.r, node.value.g, node.value.b]).toEqual([4, 2, 1]);
  });

  it('the pipeline state is the legacy material\'s: transparent, no depth test, no depth write, front-sided', async () => {
    const { mesh, legacy } = meshOf();
    const twin = await adoptFx(mesh);
    for (const k of ['transparent', 'depthTest', 'depthWrite', 'side', 'blending'] as const) expect(twin[k], k).toBe(legacy[k]);
    expect([twin.depthTest, twin.depthWrite, twin.transparent]).toEqual([false, false, true]);
  });
});
