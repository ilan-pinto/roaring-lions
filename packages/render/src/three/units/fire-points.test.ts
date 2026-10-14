import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { firePointOnMap, parseFireExtras } from './fire-points';
import { MESH_SCALE, meshYawFromFacing } from './mesh-anim';

describe('rl_fire', () => {
  it('reads the three points and drops anything else, by name', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(parseFireExtras({ muzzle: [1, 2, 3], base: [0, 0, 0] }, 'x.glb')).toEqual({ muzzle: [1, 2, 3], base: [0, 0, 0] });
    expect(parseFireExtras({ muzzle: [1, 2], flash: [0, 0, 0] }, 'x.glb')).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(2);
    expect(parseFireExtras(undefined, 'x.glb')).toBeUndefined();
    warn.mockRestore();
  });

  // The oracle is three.js itself: the point the root's own matrix carries
  // the GLB point to, at the same scale and yaw the renderer sets -- not a
  // second copy of the formula.
  it.each([0, 0.125, 0.25, 0.6, 0.9])('lands where the mesh root draws the point, facing %s turns', (turns) => {
    const root = new THREE.Object3D();
    root.position.set(10, 0, 20);
    root.scale.setScalar(MESH_SCALE);
    root.rotation.y = meshYawFromFacing(turns);
    root.updateMatrixWorld(true);
    for (const p of [[0.6, 1.25, -0.05], [-0.23, 0.72, 0.02], [0, 0, 0.5]] as const) {
      const w = new THREE.Vector3(...p).applyMatrix4(root.matrixWorld);
      const m = firePointOnMap(p, 10, 20, turns * 2 * Math.PI);
      expect(m.x).toBeCloseTo(w.x, 9);
      expect(m.y).toBeCloseTo(w.z, 9);
      expect(m.up).toBeCloseTo(w.y, 9);
    }
  });
});
