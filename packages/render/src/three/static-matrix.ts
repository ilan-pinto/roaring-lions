/**
 * Objects that never move stop recomputing their matrices every frame.
 *
 * three's `Scene.updateMatrixWorld` runs once per `render()`, and with the
 * defaults every object in the scene recomposes its local matrix from
 * position/quaternion/scale AND multiplies it into a world matrix, every
 * frame -- and because the scene itself is auto-updated, it forces that
 * multiply on every descendant whether or not anything moved. On the low-end
 * proxy that upkeep was ~1.8 ms a frame at 4x CPU (`multiplyMatrices`,
 * `updateMatrixWorld`), most of it for buildings, terrain and decor that
 * stand still for the whole mission (docs/PERFORMANCE.md, "Low-end").
 *
 * Two halves. `freezeSceneRoot` stops the scene forcing its children: the
 * scene never moves (screen shake moves a COPY of the camera, never the
 * world), so its identity matrix is settled once. Every object left on the
 * default `matrixAutoUpdate = true` still marks and recomputes itself every
 * frame exactly as before -- a unit, a projectile, a wreck settling in.
 * `freezeStatic` then takes an object that will not move again off that
 * path: its matrix is composed once, here, and its world matrix once, on the
 * next `updateMatrixWorld`.
 *
 * The cost of being wrong is silent: a frozen object whose position is
 * written later simply does not move. So it is applied only where the object
 * is built, by the code that knows it is static, and `ThreeRenderer` calls it
 * at exactly those sites -- never as a sweep over the scene. Anything frozen
 * that later has to move must call `thaw` first.
 */
import type * as THREE from 'three';

/** Composes `root`'s and every descendant's matrix now, and stops three
 *  recomposing them each frame. Returns `root`. */
export function freezeStatic<T extends THREE.Object3D>(root: T): T {
  root.traverse((o) => {
    o.matrixAutoUpdate = false;
    // Composes `matrix` from position/quaternion/scale and sets
    // `matrixWorldNeedsUpdate`, so the next `updateMatrixWorld` computes the
    // world matrix once -- and, through it, every descendant's.
    o.updateMatrix();
  });
  return root;
}

/** Puts `root` (and its descendants) back on three's per-frame update. */
export function thaw<T extends THREE.Object3D>(root: T): T {
  root.traverse((o) => {
    o.matrixAutoUpdate = true;
  });
  return root;
}

/** The scene stops forcing a world-matrix multiply on every child each
 *  frame; see this module's top comment. */
export function freezeSceneRoot(scene: THREE.Scene): void {
  scene.matrixAutoUpdate = false;
  scene.updateMatrix();
}
