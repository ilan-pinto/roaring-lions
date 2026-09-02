/**
 * Textured decor as instanced geometry -- the ditch's counterpart to
 * `decor-mesh.ts`.
 *
 * ONE `InstancedMesh` PER `<family>_<variant>` KEY, where `decor-mesh.ts`
 * uses one `BatchedMesh` per ROLE. The difference is forced rather than
 * chosen: `BatchedMesh` groups geometries that share a MATERIAL, and the
 * whole point of a textured family is that it does not share the palette
 * ramp everything else in that batch draws through. It also strips every
 * attribute but `position` and `normal` (`stripToBatchAttributes`), which
 * would throw away the UVs the texture is addressed by.
 *
 * `InstancedMesh` is the right tool anyway, and cheaper here than the batch:
 * every ditch tile on a map draws the SAME geometry with the SAME material,
 * so the whole earthwork -- however long the run -- is ONE draw call and one
 * geometry upload. Draw-call submission is this project's measured renderer
 * bottleneck, so that matters more than the vertex count does.
 */
import * as THREE from 'three';
import type { DecorPlacement } from './decor-place';
import { isTexturedDecorKey, texturedDecorMaterial } from './textured-decor';

/** One textured decor GLB's geometry and its own baked map. */
export interface TexturedDecorPart {
  readonly geometry: THREE.BufferGeometry;
  readonly map: THREE.Texture;
}

/** Keyed `${family}_${variant}`, exactly like `DecorGeometrySet`. */
export interface TexturedDecorSet {
  readonly parts: ReadonlyMap<string, TexturedDecorPart>;
}

const TAU = Math.PI * 2;

/**
 * Builds one `InstancedMesh` per referenced textured key.
 *
 * Placements whose family is not textured are ignored here and picked up by
 * `buildDecorMesh` instead; the two builders partition the same placement
 * list rather than racing for it, and `isTexturedDecorKey` is the single
 * question both sides ask.
 *
 * A key with no loaded part contributes nothing rather than throwing -- the
 * same "lose this family's objects, not the frame" contract `buildDecorMesh`
 * already has. Note what that costs HERE though: losing the ditch does not
 * merely thin some scatter, it erases an obstacle. That is a real asymmetry
 * and the reason `mesh-catalogue.ts` must list the family, so the GLB is
 * fetched wherever a map authors one.
 */
export function buildTexturedDecorMesh(
  placements: readonly DecorPlacement[],
  set: TexturedDecorSet
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'decor-textured';

  const byKey = new Map<string, DecorPlacement[]>();
  for (const p of placements) {
    const key = `${p.family}_${p.variant}`;
    if (!isTexturedDecorKey(key)) continue;
    if (!set.parts.has(key)) continue;
    const list = byKey.get(key);
    if (list === undefined) byKey.set(key, [p]);
    else list.push(p);
  }

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const axis = new THREE.Vector3(0, 1, 0);
  const scale = new THREE.Vector3();
  const position = new THREE.Vector3();
  for (const [key, list] of byKey) {
    const part = set.parts.get(key);
    if (part === undefined) continue;
    // A fresh material per build, matching `buildDecorMesh`: `rebuildTerrain`
    // disposes the whole group and re-registers what it makes, so a material
    // reused across rebuilds would be a dangling registration.
    const mesh = new THREE.InstancedMesh(
      part.geometry,
      texturedDecorMaterial(part.map),
      list.length
    );
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      q.setFromAxisAngle(axis, p.yawTurns * TAU);
      scale.set(p.scale, p.scale, p.scale);
      position.set(p.x, p.y, p.z);
      m.compose(position, q, scale);
      mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
    group.add(mesh);
  }
  return group;
}

/**
 * Disposes a group `buildTexturedDecorMesh` returned.
 *
 * Materials only -- NOT the geometry, and not the texture. Both belong to the
 * `TexturedDecorSet` the loader owns and are reused by the next rebuild;
 * `InstancedMesh.dispose` releases only the per-instance buffers it allocated
 * itself. This is the same split `disposeDecorMesh`/`disposeDecorGeometrySet`
 * already draws, and getting it wrong here would blank the ditch on the
 * second terrain rebuild rather than the first, which is the kind of bug that
 * survives a smoke test.
 */
export function disposeTexturedDecorMesh(group: THREE.Group): void {
  for (const child of [...group.children]) {
    const mesh = child as THREE.InstancedMesh;
    (mesh.material as THREE.Material).dispose();
    mesh.dispose();
    group.remove(child);
  }
}
