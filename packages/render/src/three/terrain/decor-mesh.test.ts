import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { buildDecorMesh, disposeDecorMesh, stripToBatchAttributes } from './decor-mesh';
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

  it('keeps the normal attribute — the toon ramp indexes by it', () => {
    // Stripping to `position` alone would compile and draw solid black
    // silhouettes, since `toonRampMaterial` picks its ramp entry from N·L.
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
