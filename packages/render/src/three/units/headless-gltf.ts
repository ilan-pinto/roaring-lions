/**
 * Parse a shipped GLB under plain Node, for the `*-shipped.test.ts` specs.
 * Test support only: nothing in the game imports this.
 *
 * Several shipped GLBs carry a real `base_color` image (the textured
 * vehicles, B0b/B3 infantry teams, B7 civilians). `GLTFLoader` decodes an
 * embedded image through browser globals. Node has none of them, so two
 * things went wrong:
 *
 * - `GLTFParser.loadImageSource` reads the global `self`, which Node does
 *   not define (`ReferenceError: self is not defined`). Each spec carried a
 *   `self = globalThis` shim for it, three times in one of them.
 * - With `self` shimmed, the decode still fails, because Node has no
 *   `Image` and no `createImageBitmap`. `GLTFLoader` catches the failure,
 *   logs `THREE.GLTFLoader: Couldn't load texture blob:nodedata:...` and
 *   leaves `material.map` null. That was 447 of 2,478 lines of one CI
 *   gates log (`mesh-vehicle-shipped`, `mesh-team-death-shipped`,
 *   `civilian-mesh-shipped`), on every run.
 *
 * The fix is a `GLTFLoader` plugin whose `loadTexture` hook answers every
 * texture with `null` before the parser tries to decode it. That is exactly
 * what the failing decode used to produce (`loadTexture`'s own `.catch`
 * returns null, and `assignTexture` skips a null), so every spec sees the
 * same materials, maps, clips and pivots as before. The difference is that
 * nothing decodes and nothing logs. `loadImageSource` is never reached, so
 * the `self` shim went with it.
 *
 * Falsified: with the hook commented out, the three specs print exactly
 * 447 `Couldn't load texture` lines again, the same count as the CI log.
 *
 * A non-null placeholder texture was tried first and rejected:
 * `civilian-mesh-shipped` pins a template built on null maps (one geometry
 * per material), and 17 of its tests went red. Moving those specs onto the
 * textured branch is a separate decision, not a side effect of quietening a
 * log.
 */
import type { Texture } from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';


/** Parses `bytes` with every texture resolved to `null`, undecoded and unlogged. */
export function parseGlbHeadless(bytes: Uint8Array): Promise<GLTF> {
  // `Buffer` is a `Uint8Array` view over a pool, so hand `parseAsync` a
  // standalone `ArrayBuffer` rather than the whole pool behind it.
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const loader = new GLTFLoader();
  loader.register(() => ({
    name: 'rl_headless_no_decode',
    // Typed `Promise<Texture>`, but `GLTFParser` handles a null texture
    // (it is what a failed decode resolves to), and null is the point.
    loadTexture: () => Promise.resolve(null) as unknown as Promise<Texture>,
  }));
  return loader.parseAsync(ab, '');
}
