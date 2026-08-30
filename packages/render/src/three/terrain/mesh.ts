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
import { defaultFlashUniforms, FLASH_UNIFORMS_GLSL, FLASH_SHIFT_GLSL } from '../palette-material';

/**
 * Uploads `data`'s positions, colours and indices as a `BufferGeometry`.
 * Non-indexed attributes are never shared between quads (see `ground.ts`'s
 * doc comment on why), so this is a direct, unmodified upload -- no
 * `mergeVertices`, no normal computation (the unlit material `terrainMaterial`
 * returns never reads a normal).
 *
 * `litColor` is `data.litColors` when the builder computed one (`ground.ts`'s
 * `buildGround`, the only caller today), or the SAME `BufferAttribute` as
 * `color` otherwise -- aliasing one attribute object under two names is a
 * real, supported three.js/WebGL usage (both names simply read the same
 * buffer), and it is what keeps every scatter/grove/residual/building-decor
 * mesh (none of which compute a lit variant -- see `types.ts`'s own
 * `litColors` doc comment for why) correct without a special case: the
 * terrain material's own flash shift always has a `litColor` attribute to
 * read, and for these meshes it is identical to `color`, so shifting toward
 * it is a genuine, harmless no-op rather than a missing-attribute error.
 */
export function toGeometry(data: MeshData): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
  const colorAttr = new THREE.BufferAttribute(data.colors, 3);
  geometry.setAttribute('color', colorAttr);
  geometry.setAttribute('litColor', data.litColors ? new THREE.BufferAttribute(data.litColors, 3) : colorAttr);
  geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
  return geometry;
}

/**
 * The terrain material: unlit, vertex-coloured, per the chosen look (B2 does
 * no lighting -- `toonRampMaterial` stays unused until units arrive in B3).
 * Still true today: this is a hand-written `ShaderMaterial`, not
 * `MeshBasicMaterial`, but it reads no normal and computes no `N·L` -- the
 * ONLY thing it adds over plain vertex-colour passthrough is the
 * muzzle-flash ramp shift below, which is a per-vertex colour SWAP
 * (`color` vs. `litColor`), not lighting.
 *
 * `MeshBasicMaterial` with `vertexColors: true` used to read the `color`
 * attribute straight into the fragment colour, with no colour-space
 * conversion applied to vertex colours at any stage -- so the palette bytes
 * `buildGround` wrote (already quantised, already 0..1 floats of the raw
 * hex) reached the framebuffer exactly. This hand-written material
 * reproduces that pass-through exactly (`vColor`/`vLitColor` copied straight
 * from the vertex attributes to `gl_FragColor`, no math) UNLESS a flash is
 * active nearby, in which case it swaps to `litColor` -- itself an equally
 * exact, quantised, on-palette vertex colour (`ground.ts`'s `buildGround`
 * doc comment), never a blend of the two. The swap is a hard cut (`shift > 0
 * ? vLitColor : vColor`), not an interpolated mix -- deliberately, so every
 * sampled pixel is provably one of the two baked colours at any instant,
 * matching the toon-ramp materials' own stepped, not smooth, falloff.
 */
export function terrainMaterial(): THREE.Material {
  return new THREE.ShaderMaterial({
    uniforms: { ...defaultFlashUniforms() },
    vertexShader: /* glsl */ `
      attribute vec3 color;
      attribute vec3 litColor;
      varying vec3 vColor;
      varying vec3 vLitColor;
      varying vec3 vWorldPos;
      void main() {
        vColor = color;
        vLitColor = litColor;
        vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      varying vec3 vLitColor;
      varying vec3 vWorldPos;
      ${FLASH_UNIFORMS_GLSL}
      ${FLASH_SHIFT_GLSL}
      void main() {
        int shift = flashShiftSteps(vWorldPos);
        gl_FragColor = vec4(shift > 0 ? vLitColor : vColor, 1.0);
      }
    `,
  });
}
