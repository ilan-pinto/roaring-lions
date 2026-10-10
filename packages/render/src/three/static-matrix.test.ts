import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { freezeSceneRoot, freezeStatic, thaw } from './static-matrix';

describe('static matrices', () => {
  it('a frozen object gets its world matrix once, and a mover beside it still moves', () => {
    const scene = new THREE.Scene();
    freezeSceneRoot(scene);
    const building = new THREE.Group();
    building.position.set(4, 0, 7);
    building.scale.set(2, 2, 2);
    const wall = new THREE.Object3D();
    wall.position.set(1, 0, 0);
    building.add(wall);
    scene.add(freezeStatic(building));
    const unit = new THREE.Object3D();
    scene.add(unit);
    scene.updateMatrixWorld();
    // The frozen pair landed where their transforms say...
    expect(new THREE.Vector3().setFromMatrixPosition(wall.matrixWorld).toArray()).toEqual([6, 0, 7]);
    // ...and the mover follows its position every frame, with nothing above it
    // forcing it to: the scene no longer pushes a multiply on every child.
    unit.position.set(3, 1, 2);
    scene.updateMatrixWorld();
    expect(new THREE.Vector3().setFromMatrixPosition(unit.matrixWorld).toArray()).toEqual([3, 1, 2]);
    // The frozen one does not follow a later write -- that is the contract,
    // and why `thaw` exists.
    building.position.set(9, 0, 9);
    scene.updateMatrixWorld();
    expect(new THREE.Vector3().setFromMatrixPosition(building.matrixWorld).x).toBe(4);
    thaw(building);
    scene.updateMatrixWorld();
    expect(new THREE.Vector3().setFromMatrixPosition(wall.matrixWorld).toArray()).toEqual([11, 0, 9]);
  });

  it('a frame recomposes no frozen matrix', () => {
    const scene = new THREE.Scene();
    freezeSceneRoot(scene);
    for (let i = 0; i < 20; i++) {
      const o = new THREE.Group();
      o.position.set(i, 0, 0);
      o.add(new THREE.Object3D());
      scene.add(freezeStatic(o));
    }
    scene.updateMatrixWorld();
    let composes = 0;
    let multiplies = 0;
    const compose = THREE.Matrix4.prototype.compose;
    const multiply = THREE.Matrix4.prototype.multiplyMatrices;
    THREE.Matrix4.prototype.compose = function (...a: Parameters<typeof compose>) {
      composes++;
      return compose.apply(this, a);
    };
    THREE.Matrix4.prototype.multiplyMatrices = function (...a: Parameters<typeof multiply>) {
      multiplies++;
      return multiply.apply(this, a);
    };
    try {
      scene.updateMatrixWorld();
    } finally {
      THREE.Matrix4.prototype.compose = compose;
      THREE.Matrix4.prototype.multiplyMatrices = multiply;
    }
    expect(composes).toBe(0);
    expect(multiplies).toBe(0);
  });
});
