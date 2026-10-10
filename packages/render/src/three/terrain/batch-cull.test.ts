import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { memoizeBatchCulling } from './batch-cull';

/** A row of boxes along X, some outside any frustum below. */
function batch(): THREE.BatchedMesh {
  const mesh = new THREE.BatchedMesh(32, 64, 128, new THREE.MeshBasicMaterial());
  const id = mesh.addGeometry(new THREE.BoxGeometry(0.5, 0.5, 0.5));
  const m = new THREE.Matrix4();
  for (let i = 0; i < 24; i++) {
    const inst = mesh.addInstance(id);
    mesh.setMatrixAt(inst, m.makeTranslation(i * 2 - 24, 0, (i % 5) - 2));
  }
  mesh.updateMatrixWorld(true);
  return mesh;
}

function camera(x: number, z: number): THREE.PerspectiveCamera {
  const c = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
  c.position.set(x, 8, z);
  c.lookAt(0, 0, 0);
  c.updateMatrixWorld(true);
  return c;
}

const RENDERER = { coordinateSystem: THREE.WebGLCoordinateSystem } as unknown as THREE.WebGLRenderer;

interface Internals {
  _multiDrawStarts: Int32Array;
  _multiDrawCounts: Int32Array;
  _multiDrawCount: number;
  _indirectTexture: THREE.DataTexture;
}

/** What a draw through `cam` leaves in the batch: the list three submits. */
function draw(mesh: THREE.BatchedMesh, cam: THREE.Camera): number[][] {
  mesh.onBeforeRender(RENDERER, new THREE.Scene(), cam, mesh.geometry, mesh.material as THREE.Material, new THREE.Group());
  const b = mesh as unknown as Internals;
  const n = b._multiDrawCount;
  const indirect = b._indirectTexture.image.data as unknown as Uint32Array;
  return [Array.from(b._multiDrawStarts.slice(0, n)), Array.from(b._multiDrawCounts.slice(0, n)), Array.from(indirect.slice(0, n))];
}

describe('memoizeBatchCulling', () => {
  it('hands back exactly the list three computes, per view, and computes each view once', () => {
    const near = camera(-20, 6);
    const far = camera(22, -9);
    const reference = batch();
    const want = { near: draw(reference, near), far: draw(reference, far) };
    // The two views really differ, or "per view" would prove nothing.
    expect(want.near).not.toEqual(want.far);
    expect(want.near[0].length).toBeLessThan(24);

    const compute = vi.spyOn(THREE.BatchedMesh.prototype, 'onBeforeRender');
    const mesh = memoizeBatchCulling(batch());
    expect(draw(mesh, near)).toEqual(want.near); // shadow-like pass
    expect(draw(mesh, far)).toEqual(want.far); // main pass
    expect(draw(mesh, far)).toEqual(want.far); // AO pre-pass, same camera
    expect(draw(mesh, near)).toEqual(want.near); // next frame's shadow pass
    expect(draw(mesh, far)).toEqual(want.far);
    expect(compute).toHaveBeenCalledTimes(2);

    // Moving an instance clears what was kept: the next draw recomputes, and
    // agrees with a batch that was never memoised.
    const moved = new THREE.Matrix4().makeTranslation(0, 0, 0);
    mesh.setMatrixAt(3, moved);
    reference.setMatrixAt(3, moved);
    expect(draw(mesh, far)).toEqual(draw(reference, far));
    expect(compute).toHaveBeenCalledTimes(4);
    compute.mockRestore();
  });

  it('a moved camera is a new view', () => {
    const mesh = memoizeBatchCulling(batch());
    const reference = batch();
    const cam = camera(-20, 6);
    draw(mesh, cam);
    cam.position.x += 9;
    cam.updateMatrixWorld(true);
    expect(draw(mesh, cam)).toEqual(draw(reference, cam));
  });
});
