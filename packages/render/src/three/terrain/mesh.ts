/**
 * The thin, non-pure half of the terrain pipeline: `MeshData`'s plain arrays
 * become the `THREE.BufferGeometry`/`THREE.Material` pair `ThreeRenderer`
 * hands to a `Mesh`.
 *
 * Deliberately not folded into `ground.ts`: this file is the one place in the
 * terrain pipeline that touches `THREE.*` construction rather than plain
 * arrays, which is exactly the line the module doc comments in `ground.ts`
 * and `types.ts` draw -- pure builders return data, and *something* has to
 * turn that data into GPU-facing objects.
 *
 * `toGeometry` did nothing a test could usefully assert beyond "three.js
 * accepted these buffers", which is why B2.4 added no test file here. That
 * stopped being true on 2026-09-03: `groundSurfaceMaterial` below is the
 * FOURTH named exemption from `data/palette.json` (`surface.ts`,
 * `SURFACE_SHADING_EXEMPTION`), and both of the properties that keep it
 * narrow are structural -- they live in the shader source and in one
 * arithmetic identity, not in a rendered pixel. `mesh.test.ts` asserts them.
 * The palette guarantee on the vertex COLOURS is still proved where it
 * always was, in `ground.test.ts`, on data this consumes unchanged.
 */
import * as THREE from 'three';
import type { MeshData } from './ground';
import { defaultFlashUniforms, FLASH_UNIFORMS_GLSL, FLASH_SHIFT_GLSL } from '../palette-material';

/**
 * Uploads `data`'s positions, colours and indices as a `BufferGeometry`.
 * Non-indexed attributes are never shared between quads (see `ground.ts`'s
 * doc comment on why), so this is a direct, unmodified upload -- no
 * `mergeVertices`, and no normal COMPUTATION here either: `buildGround`
 * writes its own analytic normals into `data.normals` and every other
 * builder has none, so there is nothing for this function to derive.
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
  // Surface normal -- `ground.ts` only, and only for `groundSurfaceMaterial`
  // to read. Uploaded under three.js's own reserved `normal` name (not a
  // custom one), so the attribute is the one a `ShaderMaterial` gets for
  // free without an `attribute vec3 normal;` declaration. No aliased
  // default when absent, unlike `litColor` above: a scatter mark has no
  // meaningful normal and `terrainMaterial` never asks for one.
  if (data.normals) geometry.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
  // Ground-albedo mask -- `ground.ts` only, and 1 on exactly the vertices
  // allowed to sample the sand tile. Absent for every other builder, whose
  // material declares none, the same shape `sway` above already uses.
  if (data.sandMask) geometry.setAttribute('sandMask', new THREE.BufferAttribute(data.sandMask, 1));
  if (data.rockMask) geometry.setAttribute('rockMask', new THREE.BufferAttribute(data.rockMask, 1));
  // Albedo sampling coordinates. Under a custom name rather than three.js's
  // reserved `uv`, so nothing in three's own shader chunks can be surprised
  // by a `uv` on geometry that has no material expecting one.
  if (data.groundUv) geometry.setAttribute('groundUv', new THREE.BufferAttribute(data.groundUv, 2));
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

/**
 * The sun, in world space -- `toonRampMaterial`'s own long-standing
 * `(0.5, 1, 0.3)`, normalised, so the ground is lit from where every unit,
 * building and decor mesh in this scene is already lit from. Declared here
 * rather than imported for the same reason `mesh-material.ts` and
 * `palette-material.ts` each declare their own: this module may not reach
 * into `../palette-material` for a value, only for the flash GLSL it already
 * imports, and a wrong copy would be immediately visible as ground lit from
 * one side and units from another.
 */
export const GROUND_LIGHT_DIR = new THREE.Vector3(0.5, 1, 0.3).normalize();

/**
 * How hard the surface normal drives the shade.
 *
 * The term is `1 + RELIEF * (N·L - up·L)`, so it is a DEPARTURE from flat
 * ground rather than a lighting model: at 0 the ground is exactly the flat
 * vertex colour it has always been, and it grows from there. That framing is
 * what makes the number tunable by eye without any risk of quietly
 * re-toning the four flat maps.
 *
 * The light sits 59.8 degrees above the horizon (`asin(1/|(0.5,1,0.3)|)`),
 * so the two directions are not symmetric and that is physical, not a bug:
 * a slope tilting AWAY from a near-overhead sun loses much more `N·L` than
 * one tilting toward it gains. `N·L - up·L` spans about `[-1.86, +0.14]`
 * over all possible normals, so at this strength a hillside's shaded flank
 * darkens far more than its lit flank brightens -- which is exactly how a
 * dune reads.
 */
export const GROUND_RELIEF_STRENGTH = 0.9;

/** Floor and ceiling on the shade multiplier. The floor stops a wall-steep
 *  patch going to mud (and, at strengths above ~0.54, to negative); the
 *  ceiling stops a sun-facing slope of the `arid` theme's own light
 *  limestone clipping to white. Both are outside the range flat ground can
 *  reach, so neither can affect a level tile: `clamp(1.0, 0.45, 1.14)` is
 *  1.0 exactly. */
export const GROUND_SHADE_FLOOR = 0.45;
export const GROUND_SHADE_CEIL = 1.14;

/**
 * How many world units (= game tiles) one repeat of the sand tile spans.
 *
 * Picked on screen at gameplay zoom rather than by arithmetic, which is what
 * the brief asked for. The 1024 px source carries wind ripples at roughly a
 * 60-100 px pitch; at 4 tiles per repeat those ripples land at about 16-25
 * screen pixels at zoom 1 (a tile is 64 px wide), which reads as sand grain
 * from the default camera and as ripples when zoomed in. At 8 the ripples
 * became dunes the size of a squad and started competing with the relief
 * itself; at 2 the whole thing turned to noise and the tile's repeat became
 * legible as a grid.
 */
export const GROUND_TEXTURE_TILES = 4;

/**
 * The sand tile's own mean colour, `rgb(203.5, 166.6, 110.7)`, measured off
 * `assets/textures/desert_sand_tile.png` itself.
 *
 * The texture is applied as a RATIO to this, not as a replacement: the
 * fragment is `paletteTone * (texel / mean)`. Two things follow, and both are
 * the reason for doing it this way rather than sampling the texel straight.
 *
 * The AVERAGE colour of open ground stays exactly the tile's own
 * `data/palette.json` tone -- the texture contributes variation, not hue. So
 * a road, a cover tile and open ground still relate to each other the way
 * `tones.ts` composited them, and a future theme with different tones gets a
 * correctly-tinted sand rather than this desert's.
 *
 * And it degrades to nothing: where the mask is 0, or before the image has
 * loaded, the ratio is exactly 1 and the fragment is the palette byte it
 * always was.
 */
export const GROUND_TEXTURE_MEAN = new THREE.Vector3(203.5 / 255, 166.6 / 255, 110.7 / 255);

/**
 * How many world units one repeat of the ROCK tile spans, on a ridge top and
 * on a cliff face alike.
 *
 * Half the sand's. Picked on screen for the same reason and against a
 * different subject: `tel_marum`'s ridge walls are one to two levels tall --
 * 0.26 to 0.51 world units -- so at the sand's 4 tiles per repeat a whole
 * cliff face would show about a tenth of the image's height and read as a
 * smear of one stratum. At 2 the crack network and the horizontal strata are
 * both legible on a two-level face, and the ridge TOP still reads as bedrock
 * rather than as gravel.
 *
 * It is also what makes the measured seam safe. The source's edges differ by
 * 20.9/20.2 against an adjacent-column baseline of 13.6 -- a ratio of 1.54,
 * a faint seam on paper where the sand's was 1.05 -- and a smaller repeat
 * puts more junctions on screen. The crack network hides them: photographed
 * on `tel_marum`'s longest wall at zoom 2.5, no junction is findable. If one
 * ever is, the fix is an edge cross-fade in the SOURCE, not a mirrored wrap
 * (mirroring a tile this busy draws an obvious kaleidoscope diamond).
 */
export const ROCK_TEXTURE_TILES = 2;

/** The rock tile's own mean colour, `rgb(152.9, 141.2, 125.2)`, measured off
 *  `assets/textures/rock_ground_tile.png`. Applied as a ratio to this exactly
 *  as the sand is -- so a ridge still averages to `tones.rock` composited at
 *  `FACE_ALPHA_EAST`/`SOUTH`, and the two visible faces of a cliff keep the
 *  different tones that make it read as mass rather than as a flat shape. */
export const ROCK_TEXTURE_MEAN = new THREE.Vector3(152.9 / 255, 141.2 / 255, 125.2 / 255);

/** A 1x1 opaque white texture, bound as `uSand` until (or instead of) the
 *  real one. Sampling an unbound sampler is undefined behaviour and
 *  `NaN * 0` is still `NaN`, so the strength uniform alone is not enough to
 *  make a missing asset safe -- the sampler has to be valid too. */
function whitePixel(): THREE.DataTexture {
  const tex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Makes the ground albedo tile safe for this renderer's colour pipeline, and
 * returns it. The mirror of `units/textured-building.ts`'s
 * `prepareTexturedMap`, and the colour-space line is load-bearing in exactly
 * the same way.
 *
 * `NoColorSpace`: `TextureLoader` stamps `SRGBColorSpace` on a colour map and
 * this renderer's output is pass-through (`applyPalettePipeline`), so an sRGB
 * internal format decodes on every sample with nothing to re-encode it.
 * Measured elsewhere in this tree, getting it wrong dropped a lit wall from
 * rgb 67 to 51 and still looked like a building; here it would drag the whole
 * ground off the tone `tones.ts` composited and it would still look like
 * sand.
 *
 * `RepeatWrapping` on both axes and NOT mirrored: the source was measured
 * seamless (left/right edge delta 14.6, top/bottom 15.9, against an
 * adjacent-column baseline of 14.2 -- the edges differ no more than
 * neighbouring columns do), and mirroring a seamless tile draws a visible
 * kaleidoscope diamond at every junction.
 *
 * Anisotropy is left at the renderer's default. This ground is viewed at a
 * fixed 30-degree pitch, so every fragment is at the same grazing angle and
 * there is no varying case for anisotropy to rescue.
 */
export function prepareGroundTexture(map: THREE.Texture): THREE.Texture {
  // One function for both tiles: the colour-space and wrapping rules are
  // properties of this renderer's pipeline, not of the subject.

  map.colorSpace = THREE.NoColorSpace;
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.generateMipmaps = true;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.magFilter = THREE.LinearFilter;
  map.needsUpdate = true;
  return map;
}

/**
 * The material the GROUND mesh alone draws through -- `terrainMaterial`'s
 * colour path verbatim (vertex colour, flash swap, no blend between the
 * two), plus the one thing this whole change is for: a smooth,
 * normal-driven shade.
 *
 * This is the fourth named exemption from the palette, and `surface.ts`'s
 * `SURFACE_SHADING_EXEMPTION` is its authority -- read that first. The two
 * properties this function is responsible for keeping:
 *
 *  1. **Flat ground is bit-identical to the unlit path.** `shade` is
 *     `1 + RELIEF * (N·L - up·L)`, not `1 - S * (1 - N·L)` the way the
 *     campaign board's is. Written that way, an UP normal makes the two dot
 *     products the same expression over the same operands, the difference
 *     exactly 0, and the multiplier exactly 1.0 -- so a level tile, a
 *     terrace top and every wall (all of which `ground.ts` gives the up
 *     normal deliberately) emit the identical palette bytes they emitted
 *     before this material existed. The campaign board's form cannot do
 *     this: with a light 59.8 degrees up, `1 - S * (1 - N·L)` darkens flat
 *     ground by `0.136 * S` for no reason at all, which would have re-toned
 *     every map in the game including the four with no relief.
 *  2. **The shade is SMOOTH, never banded.** `texturedBuildingMaterial`
 *     quantises into `TEXTURED_SHADE_STEPS` because a building is
 *     flat-faced and the bands land on real edges. Terrain is continuous,
 *     and three hard bands across a hillside draw contour terraces that are
 *     not in the heightfield -- which is the exact defect this work exists
 *     to remove. Same reasoning, and the same conclusion, as
 *     `campaign/world-material.ts` reached for the diorama.
 *
 * `normal` is three.js's own reserved attribute name, injected into a
 * `ShaderMaterial`'s vertex shader without being declared -- and it is in
 * WORLD space here already (`buildGround` writes world normals and the
 * ground mesh carries no transform), so it is passed through with neither
 * `normalMatrix` nor `mat3(modelMatrix)`. Only `ground.ts` populates the
 * attribute, which is why only the ground mesh may use this material.
 */
export function groundSurfaceMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    // The one setting here that is insurance rather than intent, and it was
    // measured rather than assumed. A heightfield patch turns its back on
    // this camera once it slopes away more steeply than the camera's own
    // 30-degree pitch allows -- about 3.2 levels per tile. `qarn_hadid`'s
    // steepest open ground reads 3.75 and `tel_marum`'s 4.01, and while
    // neither actually produces a back-facing triangle today (measured: 0 on
    // every shipped map), `qarn_hadid`'s closest triangle clears the
    // threshold by a dot product of 0.00001. Under the default `FrontSide`
    // that is one authored tile away from a HOLE in the map -- which reads
    // as missing geometry, not as a lighting bug. `DoubleSide` costs the
    // ground mesh its back-face culling (it is one draw call, and the
    // triangles in question are edge-on) and cannot change a single pixel of
    // a front-facing patch.
    //
    // The normal is deliberately NOT flipped for a back face: a heightfield
    // normal always points up by construction (`surfaceNormal` returns a
    // positive Y), so ground that has turned away from the camera SHOULD
    // shade as ground turned away from the light. Flipping it would light
    // the steepest slope on the map as though the sun were under it.
    side: THREE.DoubleSide,
    uniforms: {
      ...defaultFlashUniforms(),
      uLightDir: { value: GROUND_LIGHT_DIR.clone() },
      uRelief: { value: GROUND_RELIEF_STRENGTH },
      uShadeFloor: { value: GROUND_SHADE_FLOOR },
      uShadeCeil: { value: GROUND_SHADE_CEIL },
      // 0 until `setGroundTexture` supplies a real image -- so a map with no
      // texture, or one whose fetch failed, draws the flat palette tone it
      // always did rather than a white or undefined one.
      uSand: { value: whitePixel() },
      uSandStrength: { value: 0 },
      uSandMean: { value: GROUND_TEXTURE_MEAN.clone() },
      uSandTiles: { value: GROUND_TEXTURE_TILES },
      uRock: { value: whitePixel() },
      uRockStrength: { value: 0 },
      uRockMean: { value: ROCK_TEXTURE_MEAN.clone() },
      uRockTiles: { value: ROCK_TEXTURE_TILES },
    },
    vertexShader: /* glsl */ `
      attribute vec3 color;
      attribute vec3 litColor;
      attribute float sandMask;
      attribute float rockMask;
      attribute vec2 groundUv;
      varying vec3 vColor;
      varying vec3 vLitColor;
      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;
      varying float vSandMask;
      varying float vRockMask;
      varying vec2 vGroundUv;
      void main() {
        vColor = color;
        vLitColor = litColor;
        vSandMask = sandMask;
        vRockMask = rockMask;
        vGroundUv = groundUv;
        // Already world-space: buildGround writes world normals and this
        // mesh carries no transform, so the attribute is passed straight
        // through -- neither of the two transforms every other material
        // here applies. (Spelled out in prose rather than naming them:
        // mesh.test.ts asserts this source contains no such token, and a
        // comment would satisfy the grep.)
        vWorldNormal = normal;
        vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uLightDir;
      uniform float uRelief;
      uniform float uShadeFloor;
      uniform float uShadeCeil;
      uniform sampler2D uSand;
      uniform float uSandStrength;
      uniform vec3 uSandMean;
      uniform float uSandTiles;
      uniform sampler2D uRock;
      uniform float uRockStrength;
      uniform vec3 uRockMean;
      uniform float uRockTiles;
      varying vec3 vColor;
      varying vec3 vLitColor;
      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;
      varying float vSandMask;
      varying float vRockMask;
      varying vec2 vGroundUv;
      ${FLASH_UNIFORMS_GLSL}
      ${FLASH_SHIFT_GLSL}
      void main() {
        int shift = flashShiftSteps(vWorldPos);
        vec3 base = shift > 0 ? vLitColor : vColor;
        // Ground albedo, two materials over one geometry: sand on the
        // interpolated open ground, rock on a ridge. Each is a RATIO to its
        // own image mean, so the AVERAGE of a stretch of either is still the
        // palette tone the tone pipeline composited and only the variation
        // comes from the image -- see uSandMean's own doc comment.
        //
        // vGroundUv, not a projection taken from the world position here:
        // the builder emits the right planar projection per piece of
        // geometry, because projecting straight down is only correct for a
        // HORIZONTAL surface and a cliff face is not one. See
        // MeshData.groundUv. (No backticks anywhere in this shader source:
        // it is a JS template literal and one would close it mid-string.)
        //
        // Both masks 0, or neither image loaded, and every mix below is
        // exactly 1.0 -- so this whole block is a no-op on the palette byte.
        // The two fetches are unconditional rather than branched: a dynamic
        // branch around a texture fetch forces a gradient the hardware
        // cannot compute, and this is two samples on a pass that already
        // covers the screen once.
        vec3 sand = texture2D(uSand, vGroundUv / uSandTiles).rgb / uSandMean;
        vec3 rock = texture2D(uRock, vGroundUv / uRockTiles).rgb / uRockMean;
        base *= mix(vec3(1.0), sand, uSandStrength * vSandMask);
        base *= mix(vec3(1.0), rock, uRockStrength * vRockMask);
        vec3 L = normalize(uLightDir);
        // The DEPARTURE from a level surface, not an absolute N.L -- see
        // this function's doc comment, property 1. Both terms are the same
        // expression over the same operands when the normal is up, so the
        // difference there is exactly zero and shade is exactly 1.0.
        // (No backticks in this comment: it lives inside a JS template
        // literal, where one would close the shader source mid-string.)
        float rel = dot(normalize(vWorldNormal), L) - dot(vec3(0.0, 1.0, 0.0), L);
        float shade = clamp(1.0 + uRelief * rel, uShadeFloor, uShadeCeil);
        gl_FragColor = vec4(base * shade, 1.0);
      }
    `,
  });
}
