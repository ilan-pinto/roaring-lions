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
  // Wind-sway weight -- see `types.ts`'s own `MeshData.sway` doc comment.
  // Unlike `litColor` above, no aliased default when absent: only
  // `groveMaterial` below ever declares a `sway` attribute in its shader,
  // and only `buildGroves`' own output ever sets `data.sway`, so every
  // OTHER terrain sub-mesh (ground/scatter/residual/building-decor, drawn
  // through the plain `terrainMaterial` below) simply never has the
  // attribute at all -- correct, since nothing ever reads it there.
  if (data.sway) geometry.setAttribute('sway', new THREE.BufferAttribute(data.sway, 1));
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

/**
 * The grove material: `terrainMaterial`'s own vertex-colour + flash-shift
 * pass-through, verbatim (see that function's doc comment -- nothing about
 * the colour path changes here), plus wind. This is the consumer
 * `types.ts`'s `MeshData.sway` doc comment and this file's own `toGeometry`
 * comment both already named -- the `sway` attribute existed and was
 * uploaded to the GPU before this function did, but nothing read it, so
 * every tree stood dead still regardless of the per-vertex weight
 * `grove.ts`'s `buildGroves` was already computing. `groveMesh` is the only
 * mesh in `ThreeRenderer.ts` built from this material, and it is the only
 * geometry `toGeometry` ever gives a `sway` attribute to -- see its own
 * comment for why that pairing is exact, not merely conventional.
 *
 * Wind is a pure vertex-stage position offset -- `vColor`/`vLitColor` are
 * copied through completely unchanged, so nothing about the palette
 * guarantee this file's sibling functions carry is even at stake here: a
 * displaced vertex still carries the exact quantised colour `grove.ts` gave
 * it, just at a different screen position. `sway` is 0 for every vertex of
 * `pushShadow`'s flat ground marks (`grove.ts`'s own `pushPolygon` doc
 * comment), so a tree's shadow never moves even though the canopy above it
 * does.
 *
 * Direction: `(+wind, 0, -wind)` on `(x, z)` -- the SAME `(dx, -dx)` shape
 * `screenOffsetToWorld(dx, 0)` (`terrain/shared.ts`) produces for a pure
 * "camera-right" screen offset, which is the local axis every billboard
 * corner in `grove.ts` is already authored on (see that file's own top
 * comment, "a local 'right' axis"). A tree leaning along the same axis its
 * own geometry is built on reads as the crown leaning sideways; leaning on
 * an unrelated axis would read as the billboard plane itself twisting, which
 * this fixed-pitch, never-orbiting camera (`grove.ts`, same comment) would
 * expose immediately as wrong.
 *
 * Per-vertex phase (`vWorldPos.x * 0.6 + vWorldPos.z * 0.9`, both prime-ish
 * irrational-feeling multipliers chosen only to avoid a common period with
 * the other) keeps neighbouring trees out of lockstep without a second
 * per-vertex attribute -- world position is already available (needed for
 * the flash-shift check below regardless), so this reads it before wind
 * pushes it, never after: computing phase from a position that already
 * includes this same frame's wind offset would be circular, and would also
 * make the flash-shift distance check jitter with the wind instead of
 * tracking the tree's own nominal ground position.
 *
 * `uTime` is `ThreeRenderer`'s own accumulated `dtMs` total in seconds --
 * see `unitShadowMesh`'s sibling field `trackClockMs`'s own doc comment for
 * the identical "accumulated dtMs, never a direct clock read" shape, which
 * keeps this deterministic-enough for a purely cosmetic effect without
 * reading `Date.now()`/`performance.now()` from render code.
 */
export function groveMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { ...defaultFlashUniforms(), uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      attribute vec3 color;
      attribute vec3 litColor;
      attribute float sway;
      uniform float uTime;
      varying vec3 vColor;
      varying vec3 vLitColor;
      varying vec3 vWorldPos;
      void main() {
        vColor = color;
        vLitColor = litColor;
        vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
        float phase = uTime * 1.6 + vWorldPos.x * 0.6 + vWorldPos.z * 0.9;
        float wind = sin(phase) * sway * 0.05;
        vec3 swayed = position + vec3(wind, 0.0, -wind);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(swayed, 1.0);
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
