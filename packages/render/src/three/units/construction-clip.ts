/**
 * A field work under construction (#277 Task 13): the `_construction` GLB
 * drawn rising out of the ground, cut by a LOCAL clipping plane at
 * `progress x height`. The plane is the whole effect -- no animation, no
 * extra geometry -- and the maths here is pure so it is provable under node.
 *
 * Presentation only: `progress` is read from `Sim.structures.progress`
 * (Q16.16, converted by the caller) and nothing is written back (invariant 4).
 *
 * One material CLONE per unfinished instance: a `clippingPlanes` array lives
 * on the material, and the template's materials are shared by every clone of
 * a type, so a shared one would clip every site at the same height. The sim
 * caps unfinished sites at `MAX_SITES` (8), which bounds the clones.
 */
import * as THREE from 'three';

/** World Y of the clip plane for a site on ground `groundY`, `heightWorld`
 *  tall (fitted), at `progress` in [0, 1]. `null` once complete: no clip. */
export function constructionClipY(progress: number, heightWorld: number, groundY: number): number | null {
  if (progress >= 1) return null;
  const p = progress < 0 ? 0 : progress;
  return groundY + p * heightWorld;
}

/** One unfinished site's clip state: the plane (keeps everything BELOW its
 *  `constant`) and the material clones it was written onto. */
export interface ConstructionClip {
  readonly plane: THREE.Plane;
  readonly materials: readonly THREE.Material[];
}

/**
 * Swaps every mesh material under `root` (a fresh `clone(true)` of the
 * construction template, whose meshes still point at the SHARED template
 * materials) for a private clone carrying `plane`. `clipShadows` so the cast
 * shadow rises with the build rather than showing the finished silhouette.
 *
 * The plane is `(0, -1, 0)` with `constant = clipY`: a fragment is kept while
 * `-y + clipY >= 0`, i.e. below the clip height.
 */
export function attachConstructionClip(root: THREE.Object3D, clipY: number): ConstructionClip {
  const plane = new THREE.Plane(new THREE.Vector3(0, -1, 0), clipY);
  const materials: THREE.Material[] = [];
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mat = (mesh.material as THREE.Material).clone();
    mat.clippingPlanes = [plane];
    mat.clipShadows = true;
    mesh.material = mat;
    materials.push(mat);
  });
  return { plane, materials };
}

/** Releases a site's clones. Textures are NOT disposed: the clone shares its
 *  maps with the template, which owns them. */
export function disposeConstructionClip(clip: ConstructionClip): void {
  for (const m of clip.materials) m.dispose();
}
