import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { liftTone } from '../world-materials';
import { rampForPropRole } from './prop-role';
import { bakePropColors, buildPropMesh, disposePropMesh, type PropGeometrySet } from './prop-mesh';
import type { PropPlacement } from './prop-place';

const box = (): THREE.BufferGeometry => new THREE.BoxGeometry(1, 1, 1).deleteAttribute('uv');
const set: PropGeometrySet = {
  parts: new Map([
    ['tyre_pile', [{ role: 'rubber' as const, geometry: bakePropColors(box(), 'rubber') }]],
    ['wrecked_car', [
      { role: 'rust' as const, geometry: bakePropColors(box(), 'rust') },
      { role: 'metal' as const, geometry: bakePropColors(box(), 'metal') },
    ]],
  ]),
};
const at = (kind: PropPlacement['kind'], x: number): PropPlacement => ({ kind, x, z: 0, y: 0, yawTurns: 0 });

describe('bakePropColors (R-6, N-12)', () => {
  it.each(['concrete', 'metal', 'rust', 'rubber', 'cloth'] as const)('writes %s as its lit tone, linear', (role) => {
    const g = bakePropColors(box(), role);
    const c = g.getAttribute('color');
    const want = new THREE.Color(liftTone(rampForPropRole(role)));
    expect(c.itemSize).toBe(3);
    // `Math.fround`, not the raw double: the attribute is a `Float32Array`
    // (GPU vertex colours must be -- `WebGLAttributes` throws "Unsupported
    // buffer data format" on anything else, and `BatchedMesh` derives its
    // OWN combined colour buffer's type from the first geometry added, so a
    // wider array here would not stay a test-only shortcut, it would ship).
    // A double-precision `want.r/g/b` can never bit-match a value that has
    // been through that array, so the comparison is rounded to the same
    // precision the attribute actually stores.
    const wantF32 = [Math.fround(want.r), Math.fround(want.g), Math.fround(want.b)];
    for (let i = 0; i < c.count; i++) {
      expect([c.getX(i), c.getY(i), c.getZ(i)]).toEqual(wantF32);
    }
  });
});

describe('buildPropMesh', () => {
  it('draws every prop in ONE batch with ONE vertex-coloured material that casts', () => {
    const mesh = buildPropMesh([at('tyre_pile', 0), at('wrecked_car', 3), at('tyre_pile', 6)], set);
    if (!mesh) throw new Error('no mesh');
    const mat = mesh.material as THREE.MeshStandardMaterial;
    expect(mat.vertexColors).toBe(true);
    expect(mesh.castShadow).toBe(true);
    expect(mesh.receiveShadow).toBe(true);
    // `batchId` is three's own bookkeeping on some r16x builds; it is not ours.
    expect(Object.keys(mesh.geometry.attributes).filter((k) => k !== 'batchId').sort()).toEqual(['color', 'normal', 'position']);
    // 2 tyre piles x 1 part + 1 car x 2 parts. `instanceCount` is r170's getter; re-check the name.
    expect(mesh.instanceCount).toBe(4);
    disposePropMesh(mesh);
  });
  it('drops a kind whose GLB never arrived, and does not throw', () => {
    const mesh = buildPropMesh([at('water_tank', 0), at('tyre_pile', 2)], set);
    expect(mesh?.instanceCount).toBe(1);
    if (mesh) disposePropMesh(mesh);
  });
  it('is null when nothing is placed', () => {
    expect(buildPropMesh([], set)).toBeNull();
  });
});
