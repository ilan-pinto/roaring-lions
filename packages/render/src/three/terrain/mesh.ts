/**
 * The thin, non-pure half of the terrain pipeline: `MeshData`'s plain arrays
 * become the `THREE.BufferGeometry`/`THREE.Material` pair `ThreeRenderer`
 * hands to a `Mesh`.
 *
 * Deliberately not folded into `ground.ts`: this file is the one place in the
 * terrain pipeline that touches `THREE.*` construction rather than plain
 * arrays, which is exactly the line the module doc comments in `ground.ts`
 * and `types.ts` draw -- pure builders return data, and *something* has to
 * turn that data into GPU-facing objects. `toGeometry` does nothing a test
 * could usefully assert beyond "three.js accepted these buffers", which is
 * why B2.4 adds no test file here; the palette guarantee itself is proved in
 * `ground.test.ts`, on the data this consumes unchanged.
 */
import * as THREE from 'three';
import type { MeshData } from './ground';

/**
 * Uploads `data`'s positions, colours and indices as a `BufferGeometry`.
 * Non-indexed attributes are never shared between quads (see `ground.ts`'s
 * doc comment on why), so this is a direct, unmodified upload -- no
 * `mergeVertices`, no normal computation (the unlit material `terrainMaterial`
 * returns never reads a normal).
 */
export function toGeometry(data: MeshData): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(data.colors, 3));
  geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
  return geometry;
}

/**
 * The terrain material: unlit, vertex-coloured, per the chosen look (B2 does
 * no lighting -- `toonRampMaterial` stays unused until units arrive in B3).
 *
 * `MeshBasicMaterial` with `vertexColors: true` reads the `color` attribute
 * straight into the fragment colour, with no colour-space conversion applied
 * to vertex colours at any stage -- so the palette bytes `buildGround` wrote
 * (already quantised, already 0..1 floats of the raw hex) reach the
 * framebuffer exactly as long as `applyPalettePipeline`'s pass-through
 * `outputColorSpace` holds, same as the clear colour B1 proved. Step 4 of
 * this task is the readback that checks that chain end to end, on drawn
 * geometry rather than by reasoning about it.
 */
export function terrainMaterial(): THREE.Material {
  return new THREE.MeshBasicMaterial({ vertexColors: true });
}
