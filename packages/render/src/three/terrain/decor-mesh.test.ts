import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { buildDecorMesh, disposeDecorMesh, stripToBatchAttributes, swayingFoliageMaterial } from './decor-mesh';
import { swayVertexChunk } from './sway';
import type { DecorGeometrySet } from './decor-mesh';
import type { DecorPlacement } from './decor-place';

function geo(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0,0,0, 1,0,0, 0,1,0]), 3));
  g.setIndex([0, 1, 2]);
  return g;
}
const SET: DecorGeometrySet = { parts: new Map([['rock_0', [{ role: 'rock', geometry: geo() }]]]) };
const P = (n: number): DecorPlacement[] =>
  Array.from({ length: n }, (_, i) => ({
    family: 'rock' as const, variant: 0, x: i, z: i, y: 0, yawTurns: 0, scale: 1,
  }));

function batchesOf(g: THREE.Group): THREE.BatchedMesh[] {
  return g.children.filter(
    (c): c is THREE.BatchedMesh => (c as THREE.BatchedMesh).isBatchedMesh === true
  );
}

describe('buildDecorMesh', () => {
  it('draws N objects of one family in a SINGLE batched draw', () => {
    // The whole reason this is BatchedMesh and not six instancers: draw-call
    // submission is the measured bottleneck on this project.
    const g = buildDecorMesh(P(50), SET);
    // `isBatchedMesh`, NOT `.type` — three.js r170 leaves BatchedMesh's `type`
    // as the inherited "Mesh", so a `.type === 'BatchedMesh'` filter finds
    // nothing and fails against a CORRECT implementation. Verified against the
    // installed build, not assumed.
    expect(batchesOf(g).length).toBe(1);
  });

  it('places nothing, and adds no child, for an empty placement list', () => {
    expect(buildDecorMesh([], SET).children.length).toBe(0);
  });

  it('skips a placement whose geometry was never loaded, without throwing', () => {
    // A map may reference a family whose GLB failed to fetch. Losing a bush is
    // acceptable; a black screen is not.
    const missing = [{ family: 'tree' as const, variant: 2, x: 0, z: 0, y: 0, yawTurns: 0, scale: 1 }];
    expect(() => buildDecorMesh(missing, SET)).not.toThrow();
  });

  it('merges two different families sharing a role into ONE batch', () => {
    // The design claim the whole file exists for: `rock` and `slab` both use
    // the 'rock' role, so they share one ramp and MUST land in the same
    // BatchedMesh. A fixture with only one key (the original test above)
    // cannot distinguish this from "one batch per family" -- N instances of
    // ONE geometry share a batch either way. Two keys, one shared role, is
    // the only way to prove the merge actually happens.
    const set: DecorGeometrySet = {
      parts: new Map([
        ['rock_0', [{ role: 'rock', geometry: geo() }]],
        ['slab_0', [{ role: 'rock', geometry: geo() }]],
      ]),
    };
    const placements: DecorPlacement[] = [
      { family: 'rock', variant: 0, x: 0, z: 0, y: 0, yawTurns: 0, scale: 1 },
      { family: 'slab', variant: 0, x: 1, z: 1, y: 0, yawTurns: 0, scale: 1 },
    ];
    expect(batchesOf(buildDecorMesh(placements, set)).length).toBe(1);
  });

  it('keeps a different role in its own batch', () => {
    // Same fixture as the merge test above, plus a third key on a DIFFERENT
    // role -- proves roles still separate rather than everything collapsing
    // into one mesh regardless of role.
    const set: DecorGeometrySet = {
      parts: new Map([
        ['rock_0', [{ role: 'rock', geometry: geo() }]],
        ['slab_0', [{ role: 'rock', geometry: geo() }]],
        ['bush_0', [{ role: 'foliage', geometry: geo() }]],
      ]),
    };
    const placements: DecorPlacement[] = [
      { family: 'rock', variant: 0, x: 0, z: 0, y: 0, yawTurns: 0, scale: 1 },
      { family: 'slab', variant: 0, x: 1, z: 1, y: 0, yawTurns: 0, scale: 1 },
      { family: 'bush', variant: 0, x: 2, z: 2, y: 0, yawTurns: 0, scale: 1 },
    ];
    expect(batchesOf(buildDecorMesh(placements, set)).length).toBe(2);
  });

  it('gives a key holding two same-role parts an id for EACH part, not one', () => {
    // A rock-cluster family exported as several rock sub-meshes under one
    // family/variant is a natural GLB shape. Both parts' vertices are
    // reserved in the batch budget regardless -- losing the second part's id
    // to a key collision would upload its geometry to the GPU and never draw
    // it. One placement referencing this key must yield TWO instances.
    const cluster: DecorGeometrySet = {
      parts: new Map([
        ['rock_1', [{ role: 'rock', geometry: geo() }, { role: 'rock', geometry: geo() }]],
      ]),
    };
    const placements: DecorPlacement[] = [
      { family: 'rock', variant: 1, x: 0, z: 0, y: 0, yawTurns: 0, scale: 1 },
    ];
    const g = buildDecorMesh(placements, cluster);
    const mesh = batchesOf(g)[0];
    expect(mesh.instanceCount).toBe(2);
  });

  it('sizes the instance budget from the actual per-key part count, not a fixed multiplier', () => {
    // A 5-part rock cluster with only 2 placements needs 10 instances in
    // this role's batch. BatchedMesh is allocated up front and cannot grow --
    // `addInstance` throws once its budget is exhausted -- so a bound that
    // is not derived from the real per-key part count is a latent overflow,
    // not merely wasted headroom.
    const cluster: DecorGeometrySet = {
      parts: new Map([
        [
          'rock_2',
          [
            { role: 'rock', geometry: geo() },
            { role: 'rock', geometry: geo() },
            { role: 'rock', geometry: geo() },
            { role: 'rock', geometry: geo() },
            { role: 'rock', geometry: geo() },
          ],
        ],
      ]),
    };
    const placements: DecorPlacement[] = [
      { family: 'rock', variant: 2, x: 0, z: 0, y: 0, yawTurns: 0, scale: 1 },
      { family: 'rock', variant: 2, x: 1, z: 1, y: 0, yawTurns: 0, scale: 1 },
    ];
    let g!: THREE.Group;
    expect(() => {
      g = buildDecorMesh(placements, cluster);
    }).not.toThrow();
    const mesh = batchesOf(g)[0];
    expect(mesh.instanceCount).toBe(10);
  });

  it('throws on a batch whose geometries disagree about attributes — the boot crash', () => {
    // Pins the failure `stripToBatchAttributes` exists to remove, so the fix
    // cannot be quietly reverted. `BatchedMesh` takes its attribute set from
    // the FIRST geometry added and rejects any later one missing a member of
    // it. `tree_*.glb` ships a uv that grass and bush do not, and all three
    // share the `foliage` role and therefore one batch: on
    // `wadi_halam_basin` the tree landed first and the boot died with
    // `BatchedMesh: Added geometry missing "uv"`.
    const withUv = geo();
    withUv.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(6), 2));
    const mixed: DecorGeometrySet = {
      parts: new Map([
        ['tree_0', [{ role: 'foliage', geometry: withUv }]],
        ['grass_0', [{ role: 'foliage', geometry: geo() }]],
      ]),
    };
    const placements: DecorPlacement[] = [
      { family: 'tree', variant: 0, x: 0, z: 0, y: 0, yawTurns: 0, scale: 1 },
      { family: 'grass', variant: 0, x: 1, z: 1, y: 0, yawTurns: 0, scale: 1 },
    ];
    expect(() => buildDecorMesh(placements, mixed)).toThrow(/missing "uv"/);
  });

  it('batches the same mixed set once every geometry is stripped', () => {
    // The other half: after the loader normalises them, tree and grass share
    // one foliage batch with no error. Order-independent -- the uv geometry
    // is first here, which is the order that used to throw.
    const withUv = geo();
    withUv.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(6), 2));
    const stripped = stripToBatchAttributes(withUv);
    expect(stripped.getAttribute('uv')).toBeUndefined();
    // Never at the cost of what the shader actually reads.
    expect(stripped.getAttribute('position')).toBeDefined();
    const set: DecorGeometrySet = {
      parts: new Map([
        ['tree_0', [{ role: 'foliage', geometry: stripped }]],
        ['grass_0', [{ role: 'foliage', geometry: stripToBatchAttributes(geo()) }]],
      ]),
    };
    const placements: DecorPlacement[] = [
      { family: 'tree', variant: 0, x: 0, z: 0, y: 0, yawTurns: 0, scale: 1 },
      { family: 'grass', variant: 0, x: 1, z: 1, y: 0, yawTurns: 0, scale: 1 },
    ];
    let g!: THREE.Group;
    expect(() => {
      g = buildDecorMesh(placements, set);
    }).not.toThrow();
    expect(batchesOf(g).length).toBe(1);
    expect(batchesOf(g)[0].instanceCount).toBe(2);
  });

  it('draws through a lit standard material and both casts and receives shadows', () => {
    // The flags are what put decor into the sun's shadow map at all. Without
    // `castShadow` a boulder sits on ground it does not darken, which reads as
    // an object pasted onto the map rather than standing on it -- and it is
    // exactly the kind of miss no other test in this file can see, since every
    // assertion here is about batching and none about light.
    const mesh = batchesOf(buildDecorMesh(P(3), SET))[0];
    expect((mesh.material as THREE.MeshStandardMaterial).isMeshStandardMaterial).toBe(true);
    expect(mesh.castShadow).toBe(true);
    expect(mesh.receiveShadow).toBe(true);
  });

  it('keeps the normal attribute — the sun shades by it', () => {
    // Stripping to `position` alone would compile and draw flat, unlit-looking
    // blobs: `rampMaterial` carries one tone and the whole of its form comes
    // from `N·L` against the scene sun.
    const g = geo();
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(9), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(6), 2));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(9), 3));
    stripToBatchAttributes(g);
    expect(Object.keys(g.attributes).sort()).toEqual(['normal', 'position']);
  });

  it('disposes every geometry and material it created', () => {
    const g = buildDecorMesh(P(4), SET);
    const mesh = batchesOf(g)[0];
    const material = mesh.material as THREE.Material;
    // Observe the actual dispose calls rather than only the child count --
    // an implementation that removes children without ever calling
    // `.dispose()` on the mesh or material would pass a child-count-only
    // assertion unchanged.
    const materialDispose = vi.spyOn(material, 'dispose');
    const meshDispose = vi.spyOn(mesh, 'dispose');
    disposeDecorMesh(g);
    expect(materialDispose).toHaveBeenCalledTimes(1);
    expect(meshDispose).toHaveBeenCalledTimes(1);
    expect(g.children.length).toBe(0);
  });
});

/** mesh.test.ts's meshphysical harness, copied: the standard material's own
 *  sources with this material's injection applied. */
function compiled(material: THREE.Material): {
  uniforms: Record<string, THREE.IUniform>;
  vertexShader: string;
  fragmentShader: string;
} {
  const shader = {
    uniforms: {} as Record<string, THREE.IUniform>,
    vertexShader: THREE.ShaderChunk.meshphysical_vert,
    fragmentShader: THREE.ShaderChunk.meshphysical_frag,
  };
  material.onBeforeCompile(
    shader as unknown as THREE.WebGLProgramParametersWithUniforms,
    {} as THREE.WebGLRenderer
  );
  return shader;
}

/** One bush (foliage + trunk), one rock, one sand: every decor role once. */
function geometrySetOfEveryRole(): DecorGeometrySet {
  return {
    parts: new Map([
      ['bush_0', [{ role: 'foliage', geometry: new THREE.BoxGeometry() }, { role: 'trunk', geometry: new THREE.BoxGeometry() }]],
      ['rock_0', [{ role: 'rock', geometry: new THREE.BoxGeometry() }]],
      ['sand_0', [{ role: 'sand', geometry: new THREE.BoxGeometry() }]],
    ]),
  };
}
function placementsOfEveryRole(): DecorPlacement[] {
  return (['bush', 'rock', 'sand'] as const).map((family, i) => ({
    family, variant: 0, x: i, z: 0, y: 0, yawTurns: 0, scale: 1,
  }));
}

describe('the foliage batch sways (Task 7)', () => {
  const sway = { time: { value: 0 }, amp: { value: 1 } };
  it('splices the sway chunk after project_vertex and shares the two uniforms', () => {
    const shader = compiled(swayingFoliageMaterial(['#6E7446', '#5A5F39', '#474B2D'], sway));
    const at = shader.vertexShader.indexOf('#include <project_vertex>');
    expect(at).toBeGreaterThanOrEqual(0);
    // The brief wrote `indexOf('uSwayTime')`, but GLSL needs the uniform
    // DECLARED at global scope, which is before `main` and so before the
    // anchor. What must sit after the anchor is its use: the chunk itself.
    expect(shader.vertexShader.indexOf(swayVertexChunk())).toBeGreaterThan(at);
    expect(shader.vertexShader.lastIndexOf('uSwayTime')).toBeGreaterThan(at);
    expect(shader.vertexShader.indexOf('uniform float uSwayTime;')).toBeLessThan(shader.vertexShader.indexOf('void main'));
    expect(shader.uniforms.uSwayTime).toBe(sway.time);
    expect(shader.uniforms.uSwayAmp).toBe(sway.amp);
  });
  it('throws when three no longer has the chunk it splices after', () => {
    const m = swayingFoliageMaterial(['#6E7446'], sway);
    const shader = { uniforms: {}, vertexShader: 'void main(){}', fragmentShader: '' };
    expect(() => m.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer)).toThrow(/project_vertex/);
  });
  it('is only the foliage role: trunks, rock and sand keep the plain ramp material', () => {
    const group = buildDecorMesh(placementsOfEveryRole(), geometrySetOfEveryRole(), sway);
    expect(group.children.map((c) => c.name).sort()).toEqual(['decor-foliage', 'decor-rock', 'decor-sand', 'decor-trunk']);
    for (const child of group.children) {
      const mat = (child as THREE.BatchedMesh).material as THREE.Material;
      expect(mat.customProgramCacheKey() === 'rl-foliage-sway').toBe(child.name === 'decor-foliage');
    }
  });
  it('does not sway at all without the uniforms: no caller, no sway', () => {
    const group = buildDecorMesh(placementsOfEveryRole(), geometrySetOfEveryRole());
    for (const child of group.children) {
      expect(((child as THREE.BatchedMesh).material as THREE.Material).customProgramCacheKey()).not.toBe('rl-foliage-sway');
    }
  });
});
