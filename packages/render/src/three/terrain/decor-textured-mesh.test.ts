import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  buildTexturedDecorMesh,
  disposeTexturedDecorMesh,
  type TexturedDecorSet,
} from './decor-textured-mesh';
import type { DecorPlacement } from './decor-place';

function part(): { geometry: THREE.BufferGeometry; map: THREE.Texture } {
  return { geometry: new THREE.BoxGeometry(1, 1, 1), map: new THREE.Texture() };
}

function set(keys: readonly string[]): TexturedDecorSet {
  return { parts: new Map(keys.map((k) => [k, part()])) };
}

function place(over: Partial<DecorPlacement> = {}): DecorPlacement {
  return {
    family: 'ditch',
    variant: 0,
    x: 1.5,
    z: 2.5,
    y: 0,
    yawTurns: 0,
    scale: 1,
    ...over,
  };
}

describe('buildTexturedDecorMesh', () => {
  it('draws a whole ditch run in ONE instanced mesh', () => {
    // Draw-call submission is this renderer's measured bottleneck, and a
    // ditch can be dozens of tiles long. One geometry, one material, one
    // draw -- not one per tile.
    const group = buildTexturedDecorMesh(
      [place({ x: 0.5 }), place({ x: 1.5 }), place({ x: 2.5 }), place({ x: 3.5 })],
      set(['ditch_0'])
    );
    expect(group.children.length).toBe(1);
    expect((group.children[0] as THREE.InstancedMesh).count).toBe(4);
  });

  it('ignores placements from palette families', () => {
    // The two builders partition one placement list. If this took a boulder
    // it would draw it through the ditch's own photograph.
    //
    // `boulder_1` is deliberately IN the set. Without it this test passes
    // whether or not the family filter exists at all -- the missing-key skip
    // just below would drop the boulder anyway, and deleting
    // `isTexturedDecorKey` from the builder was measured leaving this green.
    // Loading a boulder into the set is what makes the family filter the only
    // thing that can exclude it.
    const group = buildTexturedDecorMesh(
      [place(), place({ family: 'boulder', variant: 1 }), place({ family: 'rock', variant: 0 })],
      set(['ditch_0', 'boulder_1'])
    );
    expect(group.children.length).toBe(1);
    const mesh = group.children[0] as THREE.InstancedMesh;
    expect(mesh.count).toBe(1);
  });

  it('drops a key whose GLB never loaded rather than throwing', () => {
    const group = buildTexturedDecorMesh([place()], set([]));
    expect(group.children.length).toBe(0);
  });

  it('places each instance at its own position, yaw and scale', () => {
    const group = buildTexturedDecorMesh(
      [place({ x: 4.5, z: 6.5, y: 0.25, yawTurns: 0.25, scale: 1 })],
      set(['ditch_0'])
    );
    const mesh = group.children[0] as THREE.InstancedMesh;
    const m = new THREE.Matrix4();
    mesh.getMatrixAt(0, m);
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scl = new THREE.Vector3();
    m.decompose(pos, quat, scl);
    expect(pos.x).toBeCloseTo(4.5, 6);
    expect(pos.y).toBeCloseTo(0.25, 6);
    expect(pos.z).toBeCloseTo(6.5, 6);
    expect(scl.x).toBeCloseTo(1, 6);
    // A quarter turn about +Y: the GLB's long axis is +X, so this is what
    // turns a run from east-west to north-south.
    const euler = new THREE.Euler().setFromQuaternion(quat, 'YXZ');
    expect(euler.y).toBeCloseTo(Math.PI / 2, 6);
  });

  it('disposes its materials but NOT the geometry or texture it borrowed', () => {
    // The subtle one. Geometry and map belong to the loader's own
    // TexturedDecorSet and are reused by every later rebuild; disposing them
    // here would blank the ditch on the SECOND terrain rebuild, not the
    // first, which is exactly the kind of bug a smoke test walks past.
    const s = set(['ditch_0']);
    const loaded = s.parts.get('ditch_0');
    if (loaded === undefined) throw new Error('fixture');
    let geometryDisposed = false;
    let mapDisposed = false;
    let materialDisposed = false;
    loaded.geometry.addEventListener('dispose', () => {
      geometryDisposed = true;
    });
    loaded.map.addEventListener('dispose', () => {
      mapDisposed = true;
    });
    const group = buildTexturedDecorMesh([place()], s);
    ((group.children[0] as THREE.InstancedMesh).material as THREE.Material).addEventListener(
      'dispose',
      () => {
        materialDisposed = true;
      }
    );
    disposeTexturedDecorMesh(group);
    expect(materialDisposed).toBe(true);
    expect(geometryDisposed).toBe(false);
    expect(mapDisposed).toBe(false);
    expect(group.children.length).toBe(0);
  });
});
