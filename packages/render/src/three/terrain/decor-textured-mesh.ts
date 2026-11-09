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
 *
 * ...until the earthwork is long. three culls an `InstancedMesh` as ONE object
 * by the sphere around all its instances, and a ditch GLB is ~38k triangles a
 * segment, so a map's whole ditch was drawn in the shadow, AO and main passes
 * whatever the camera saw: 22M of Rujm Sawda's 23M triangles a frame (GH-913).
 * A map above 48 x 48 therefore gets one mesh per CHUNK of its ditch
 * (`chunks.ts`, `grid`), 8 tiles to a side; a map of 48 x 48 or less is the one
 * mesh described above.
 */
import * as THREE from 'three';
import { texturedMapMaterial } from '../world-materials';
import type { DecorPlacement } from './decor-place';
import { isTexturedDecorKey } from './textured-decor';
import { chunkOfPoint, type ChunkGrid } from './chunks';
import { lod1Active } from '../units/structure-instances';

/**
 * GH-974: a textured family's LOD1 twin is the part keyed `<family>_lod1` (`ditch_lod1`: 1,770 triangles against the
 * ditch's 38,240). It ships no material of its own, and the loader hands it the map of `<family>_0`, so it is drawn
 * with the full ditch's own bake. `userData.lod1` on a chunk mesh says which art it is (`false`: the full one,
 * `true`: the twin), and `stepTexturedDecorLod` shows exactly one of each pair.
 */
export const LOD1_VARIANT = 'lod1';

/** The key of the twin of `key` (`ditch_0` -> `ditch_lod1`), or null for a key that is not a variant-0 one. */
export function lod1KeyOf(key: string): string | null {
  return key.endsWith('_0') ? `${key.slice(0, -2)}_${LOD1_VARIANT}` : null;
}

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
  set: TexturedDecorSet,
  grid: ChunkGrid | null = null
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
    // disposes the whole group and everything it made, so a material reused
    // across rebuilds would be a dangling reference to a disposed program.
    // One per KEY, shared by that key's chunks.
    const material = texturedMapMaterial(part.map);
    // `InstancedMesh` is culled as ONE object by the bounding sphere of all its instances, so a
    // whole-map ditch is drawn in every pass whatever the camera sees -- and a ditch GLB is tens of
    // thousands of triangles, which made it nearly the whole triangle count of a frame (GH-913 L7).
    // A chunked map (`chunks.ts`) files each placement into a chunk and makes one mesh per chunk,
    // so a chunk out of view is skipped whole. A whole map is one chunk: the one mesh it always had.
    const chunks = new Map<number, DecorPlacement[]>();
    for (const p of list) {
      const c = grid === null ? 0 : chunkOfPoint(grid, p.x, p.z);
      const bucket = chunks.get(c);
      if (bucket === undefined) chunks.set(c, [p]);
      else bucket.push(p);
    }
    for (const chunk of [...chunks.keys()].sort((a, b) => a - b)) {
      const bucket = chunks.get(chunk) as DecorPlacement[];
      const mesh = new THREE.InstancedMesh(part.geometry, material, bucket.length);
      mesh.userData.chunk = chunk;
      // A ditch is cut INTO the ground and still owes both: its far lip throws a
      // shadow down the trench, which is most of what makes it read as depth
      // rather than as a dark stripe painted on the map.
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      for (let i = 0; i < bucket.length; i++) {
        const p = bucket[i];
        q.setFromAxisAngle(axis, p.yawTurns * TAU);
        scale.set(p.scale, p.scale, p.scale);
        position.set(p.x, p.y, p.z);
        m.compose(position, q, scale);
        mesh.setMatrixAt(i, m);
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.userData.lod1 = false;
      group.add(mesh);
      // The twin: one more InstancedMesh per chunk, the same placements and the same material, hidden until
      // `stepTexturedDecorLod` turns it on below the zoom band. One draw per chunk either way.
      const twinKey = lod1KeyOf(key);
      const twinPart = twinKey === null ? undefined : set.parts.get(twinKey);
      if (twinPart !== undefined) {
        const twin = new THREE.InstancedMesh(twinPart.geometry, material, bucket.length);
        twin.userData.chunk = chunk;
        twin.userData.lod1 = true;
        twin.castShadow = true;
        twin.receiveShadow = true;
        twin.visible = false;
        twin.instanceMatrix.copy(mesh.instanceMatrix);
        twin.instanceMatrix.needsUpdate = true;
        group.add(twin);
      }
    }
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

/**
 * Shows the twin or the full art of every chunk, for this frame's zoom. `was` is the state last frame (the band's
 * hysteresis: on below `STRUCTURE_LOD1_BELOW_ZOOM`, held until 0.05 above it); returns the new one. `enabled` false
 * is the A/B switch: full art at every zoom. A group with no twin meshes is left exactly as it was.
 */
export function stepTexturedDecorLod(group: THREE.Group, zoom: number, was: boolean, enabled: boolean): boolean {
  // No twin in the group (it failed to load, or the family has none): the full art stays, at every zoom.
  if (!group.children.some((c) => c.userData.lod1 === true)) return false;
  const on = enabled && lod1Active(zoom, was);
  for (const child of group.children) {
    const lod = (child as THREE.Object3D).userData.lod1;
    if (lod === undefined) continue;
    child.visible = lod === on;
  }
  return on;
}
