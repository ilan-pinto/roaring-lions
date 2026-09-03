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
  // The three surfaces added on 2026-09-03, each its own mask for the reason
  // `types.ts` gives for keeping sand and rock apart: they are separate
  // decisions about separate surfaces, each asserted on its own.
  if (data.roadMask) geometry.setAttribute('roadMask', new THREE.BufferAttribute(data.roadMask, 1));
  // Not a mask at all -- which axis this road tile's ruts run along. Uploaded
  // beside `roadMask` rather than folded into it because a mask of 0 and an
  // axis of 0 are different facts, and packing them would make "no road here"
  // indistinguishable from "a road running north-south".
  if (data.roadAxis) geometry.setAttribute('roadAxis', new THREE.BufferAttribute(data.roadAxis, 1));
  if (data.scrubMask) geometry.setAttribute('scrubMask', new THREE.BufferAttribute(data.scrubMask, 1));
  if (data.groveMask) geometry.setAttribute('groveMask', new THREE.BufferAttribute(data.groveMask, 1));
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
 * Every ground albedo this renderer knows how to draw, by the BASENAME of
 * its file in `assets/textures/`.
 *
 * A table rather than a growing pile of `FOO_TEXTURE_MEAN` / `FOO_TEXTURE_
 * TILES` pairs, because the two numbers are properties of the IMAGE, not of
 * the surface it happens to be wired to: `desert_sand_tile` and
 * `green_basin_tile` occupy the same slot (open ground, chosen by
 * `map.terrain`) and must be able to carry different numbers into it. The
 * renderer therefore derives both from the URL it was handed rather than
 * from which uniform it is filling -- see `ThreeRenderer.loadGroundTexture`,
 * which refuses to bind an image this table does not name (the ground keeps
 * its flat palette tone and warns, rather than being multiplied by a mean
 * somebody guessed).
 *
 * `mean` is the image's own mean colour in 0..255 bytes, measured off the
 * shipped PNG -- `mesh.test.ts` recomputes every one of them from
 * `assets/textures/` and fails if a number here drifts from its file. The
 * texture is applied as a RATIO to it, never as a replacement, which is what
 * keeps this exemption to the VARIATION only (see `GROUND_TEXTURE_MEAN`
 * below, and `surface.ts`'s `SURFACE_SHADING_EXEMPTION`).
 *
 * `tiles` is how many world units (= game tiles) one repeat spans. Every one
 * was picked on screen at gameplay zoom, and the reasoning per image is on
 * its own line.
 *
 * `gain` is how far the image's deviation from its own mean is AMPLIFIED --
 * the material's `uXStrength`, which is 0 until the image loads and this
 * number afterwards. **It cannot move the average**, and that is what makes
 * it safe: the fragment is `mix(1, texel/mean, g)` = `1 + g*(texel/mean - 1)`,
 * whose mean over the image is exactly 1 for ANY g, because `mean(texel/mean)`
 * is 1 by construction. So a surface still averages to the
 * `data/palette.json` tone the tone pipeline composited no matter how hard
 * its texture is driven, and the palette exemption stays scoped to the
 * variation.
 *
 * Why any image needs more than 1: a 1024 px source drawn across ONE 64 px
 * tile is minified 16x, and everything finer than that averages away. What
 * survives is measured as std/mean of the image box-filtered to its
 * on-screen size at zoom 1 (`tools/src/ground-albedo.test.ts` recomputes it
 * from the shipped PNGs and fails below 0.05):
 *
 * | image              | tiles | raw  | x gain |
 * |--------------------|-------|------|--------|
 * | desert_sand_tile   | 4     | .060 | .060   |
 * | rock_ground_tile   | 2     | .112 | .112   |
 * | green_basin_tile   | 2     | .058 | .116   |
 * | road_track_tile    | 1     | .039 | .116   |
 * | rough_scrub_tile   | 2     | .129 | .258   |
 * | orchard_floor_tile | 2     | .130 | .196   |
 *
 * `desert_sand_tile`'s 0.060 is the reference: it is the surface that was
 * signed off on screen at gain 1, so it is what "enough" looks like. The
 * road's raw 0.039 is BELOW it, which is not a rounding difference -- it was
 * photographed at gain 1 and the road drew as a flat tan band with the sand
 * beside it fully rippled. The two vegetation surfaces sit deliberately
 * higher than open ground: a thicket and a ploughed orchard are busier than
 * the ground around them, and on a cover tile the gain is further scaled by
 * `ground.ts`'s `SCRUB_TIER_STRENGTH`, so the three tiers land at .103/.168/
 * .258 against open sand's .060 -- a monotone, well-separated ladder.
 */
export const GROUND_ALBEDOS = {
  /**
   * Open ground, `arid`.
   *
   * The 1024 px source carries wind ripples at roughly a 60-100 px pitch; at
   * 4 tiles per repeat those ripples land at about 16-25 screen pixels at
   * zoom 1 (a tile is 64 px wide), which reads as sand grain from the default
   * camera and as ripples when zoomed in. At 8 the ripples became dunes the
   * size of a squad and started competing with the relief itself; at 2 the
   * whole thing turned to noise and the tile's repeat became legible as a
   * grid.
   */
  desert_sand_tile: { tiles: 4, gain: 1, mean: [203.5, 166.6, 110.7] },
  /**
   * Open ground, `green` -- today `wadi_halam_basin` alone, the whole
   * Naharin arc, which until now drew desert sand.
   *
   * HALF the sand's repeat, and the reason is a measured difference between
   * the two images rather than a preference. The sand tile has large-scale
   * structure (wind ripples, a 60-100 px pitch) and its repeat is chosen to
   * size THOSE. This one has none worth speaking of -- its column and row
   * means both vary by a std of 2.38 grey levels, against a per-pixel std of
   * 28.4 -- so the repeat sizes the BLADES instead, and at the sand's 4 they
   * fall to about 2.5 screen pixels at zoom 1 and mip down to a flat wash.
   * At 2 they read as dry grass.
   *
   * The image is straw-coloured (mean rgb 156, 128, 85) and the ground it
   * draws is not: the ratio form retints it to whatever `tones.open`
   * composited, which for `green` is `grass.2`. Only the blade structure
   * comes from the image, which is the entire point of the ratio and is why
   * a second, greener source was not asked for.
   */
  green_basin_tile: { tiles: 2, gain: 2, mean: [156.3, 128.0, 84.9] },
  /**
   * A `^` rock ridge, its flat top and the cliff faces below it alike.
   *
   * Half the sand's, picked against a different subject: `tel_marum`'s ridge
   * walls are one to two levels tall -- 0.26 to 0.51 world units -- so at the
   * sand's 4 a whole cliff face would show about a tenth of the image's
   * height and read as a smear of one stratum. At 2 the crack network and the
   * horizontal strata are both legible on a two-level face, and the ridge TOP
   * still reads as bedrock rather than as gravel.
   *
   * It is also what makes the measured seam safe. The source's edges differ
   * by 20.9/20.2 against an adjacent-column baseline of 13.6 -- a ratio of
   * 1.54, a faint seam on paper where the sand's was 1.05 -- and a smaller
   * repeat puts more junctions on screen. The crack network hides them:
   * photographed on `tel_marum`'s longest wall at zoom 2.5, no junction is
   * findable. If one ever is, the fix is an edge cross-fade in the SOURCE,
   * not a mirrored wrap (mirroring a tile this busy draws an obvious
   * kaleidoscope diamond).
   */
  rock_ground_tile: { tiles: 2, gain: 1, mean: [152.9, 141.2, 125.2] },
  /**
   * An `r` dirt road.
   *
   * **1, and this one is not a matter of taste -- it is the only value that
   * works.** The source is not a field of road; it is ONE wheel track,
   * centred, with gravel shoulders either side (the smooth low-variance lane
   * is centred at 0.492 of the image width, measured). At any repeat but 1
   * the track stops being tile-anchored and a road tile shows whatever
   * fraction of a track its world position happens to land on. At 1, world
   * tile boundaries are integers and the repeat is one world unit, so every
   * road tile shows the full cross-section with the lane down its own centre.
   *
   * The price is that the image repeats every tile ALONG the road too, and
   * that is affordable for the same reason it is measurable: the source's
   * row means vary by a std of 1.70 grey levels against the columns' 4.74,
   * so there is almost nothing along the axis to see repeating. What DOES
   * repeat is the shoulder gravel, at about 1.2 screen pixels a pebble at
   * zoom 1.
   */
  road_track_tile: { tiles: 1, gain: 3, mean: [156.4, 139.0, 115.6] },
  /**
   * A `1`/`2`/`3` cover tile.
   *
   * 2, sizing the twig-and-pebble clutter to about 3 screen pixels at zoom 1
   * and 8 at zoom 2.5 -- fine enough to read as ground at the default camera
   * and as scrub when the player leans in, which is the zoom at which they
   * are deciding whether to move into it.
   */
  rough_scrub_tile: { tiles: 2, gain: 2, mean: [109.1, 93.8, 75.2] },
  /**
   * An `o` olive grove's floor, under the trees `grove.ts` draws.
   *
   * 2, sizing the source's plough furrows (a ~128 px pitch in 1024) to about
   * 16 screen pixels at zoom 1. The furrows are strongly directional -- row
   * means vary by a std of 7.77 against the columns' 2.27 -- and unlike the
   * road they take NO per-tile rotation, deliberately: an orchard is planted
   * in rows, so every grove tile on a map running its furrows the same way
   * is the correct picture rather than a missing feature.
   */
  orchard_floor_tile: { tiles: 2, gain: 1.5, mean: [132.0, 77.3, 42.8] },
} as const satisfies Record<
  string,
  { readonly tiles: number; readonly gain: number; readonly mean: readonly [number, number, number] }
>;

/** A key of `GROUND_ALBEDOS` -- the basename of a file in
 *  `assets/textures/`, which is how `ThreeRenderer` resolves a URL back to
 *  its mean and repeat. */
export type GroundAlbedoId = keyof typeof GROUND_ALBEDOS;

/** `GROUND_ALBEDOS[id].mean` as the 0..1 `THREE.Vector3` the uniform wants.
 *  A fresh vector per call: uniforms are mutable, and handing two materials
 *  the same object would make one's write the other's. */
export function albedoMean(id: GroundAlbedoId): THREE.Vector3 {
  const [r, g, b] = GROUND_ALBEDOS[id].mean;
  return new THREE.Vector3(r / 255, g / 255, b / 255);
}

/**
 * The five albedo SLOTS `groundSurfaceMaterial` declares, in the order the
 * fragment shader multiplies them, and the uniform-name stem each one uses
 * (`sand` -> `uSand`, `uSandStrength`, `uSandMean`, `uSandTiles`).
 *
 * A slot is a SURFACE, not an image. `sand` is the open-ground slot and takes
 * `desert_sand_tile` or `green_basin_tile` depending on `map.terrain` -- the
 * name is historical and kept because renaming it would churn the shader, the
 * uniforms, the attribute, three tests and the exemption text for nothing.
 * Every other slot happens to have exactly one image today.
 *
 * Exported so `ThreeRenderer` can loop rather than repeating four uniform
 * names five times, and so `mesh.test.ts` can assert that every stem here
 * really has all four uniforms and a matching mask attribute in the shader
 * source -- a slot added to one and not the other is otherwise silent (the
 * uniform is simply never written, and the ground draws its flat tone).
 */
export const GROUND_SLOTS = ['sand', 'rock', 'road', 'scrub', 'grove'] as const;
export type GroundSlot = (typeof GROUND_SLOTS)[number];

/** `sand` -> `uSand`. The one place the stem-to-uniform spelling lives. */
export function slotUniforms(slot: GroundSlot): {
  map: string;
  strength: string;
  mean: string;
  tiles: string;
} {
  const stem = `u${slot.charAt(0).toUpperCase()}${slot.slice(1)}`;
  return { map: stem, strength: `${stem}Strength`, mean: `${stem}Mean`, tiles: `${stem}Tiles` };
}

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
      // One quartet per `GROUND_SLOTS` entry. `mean` and `tiles` start at the
      // image the slot draws today and are OVERWRITTEN at load time from
      // `GROUND_ALBEDOS`, because the open-ground slot takes two different
      // images with different numbers -- see `ThreeRenderer.loadGroundTexture`.
      // Until then `strength` is 0, so neither is read.
      uSand: { value: whitePixel() },
      uSandStrength: { value: 0 },
      uSandMean: { value: albedoMean('desert_sand_tile') },
      uSandTiles: { value: GROUND_ALBEDOS.desert_sand_tile.tiles },
      uRock: { value: whitePixel() },
      uRockStrength: { value: 0 },
      uRockMean: { value: albedoMean('rock_ground_tile') },
      uRockTiles: { value: GROUND_ALBEDOS.rock_ground_tile.tiles },
      uRoad: { value: whitePixel() },
      uRoadStrength: { value: 0 },
      uRoadMean: { value: albedoMean('road_track_tile') },
      uRoadTiles: { value: GROUND_ALBEDOS.road_track_tile.tiles },
      uScrub: { value: whitePixel() },
      uScrubStrength: { value: 0 },
      uScrubMean: { value: albedoMean('rough_scrub_tile') },
      uScrubTiles: { value: GROUND_ALBEDOS.rough_scrub_tile.tiles },
      uGrove: { value: whitePixel() },
      uGroveStrength: { value: 0 },
      uGroveMean: { value: albedoMean('orchard_floor_tile') },
      uGroveTiles: { value: GROUND_ALBEDOS.orchard_floor_tile.tiles },
    },
    vertexShader: /* glsl */ `
      attribute vec3 color;
      attribute vec3 litColor;
      attribute float sandMask;
      attribute float rockMask;
      attribute float roadMask;
      attribute float roadAxis;
      attribute float scrubMask;
      attribute float groveMask;
      attribute vec2 groundUv;
      varying vec3 vColor;
      varying vec3 vLitColor;
      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;
      varying float vSandMask;
      varying float vRockMask;
      varying float vRoadMask;
      varying float vRoadAxis;
      varying float vScrubMask;
      varying float vGroveMask;
      varying vec2 vGroundUv;
      void main() {
        vColor = color;
        vLitColor = litColor;
        vSandMask = sandMask;
        vRockMask = rockMask;
        vRoadMask = roadMask;
        vRoadAxis = roadAxis;
        vScrubMask = scrubMask;
        vGroveMask = groveMask;
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
      uniform sampler2D uRoad;
      uniform float uRoadStrength;
      uniform vec3 uRoadMean;
      uniform float uRoadTiles;
      uniform sampler2D uScrub;
      uniform float uScrubStrength;
      uniform vec3 uScrubMean;
      uniform float uScrubTiles;
      uniform sampler2D uGrove;
      uniform float uGroveStrength;
      uniform vec3 uGroveMean;
      uniform float uGroveTiles;
      varying vec3 vColor;
      varying vec3 vLitColor;
      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;
      varying float vSandMask;
      varying float vRockMask;
      varying float vRoadMask;
      varying float vRoadAxis;
      varying float vScrubMask;
      varying float vGroveMask;
      varying vec2 vGroundUv;
      ${FLASH_UNIFORMS_GLSL}
      ${FLASH_SHIFT_GLSL}
      void main() {
        int shift = flashShiftSteps(vWorldPos);
        vec3 base = shift > 0 ? vLitColor : vColor;
        // Ground albedo, five materials over one geometry: open ground (sand
        // on an arid map, dry sward on a green one), rock on a ^ ridge, the
        // wheel track on a road, scrub on a cover tile, orchard floor under a
        // grove. Each is a RATIO to its own image mean, so the AVERAGE of a
        // stretch of any of them is still the palette tone the tone pipeline
        // composited and only the variation comes from the image -- see
        // GROUND_ALBEDOS' own doc comment.
        //
        // The five masks are mutually exclusive by construction (a tile is
        // one surface), so the multiplies could have been a chain of
        // branches; they are a chain of MIXES because at most one factor is
        // ever anything but exactly vec3(1.0) and a mix by 0 is free where a
        // branch is not.
        //
        // vGroundUv, not a projection taken from the world position here:
        // the builder emits the right planar projection per piece of
        // geometry, because projecting straight down is only correct for a
        // HORIZONTAL surface and a cliff face is not one. See
        // MeshData.groundUv. (No backticks anywhere in this shader source:
        // it is a JS template literal and one would close it mid-string.)
        //
        // Every mask 0, or no image loaded, and every mix below is exactly
        // 1.0 -- so this whole block is a no-op on the palette byte. The
        // fetches are unconditional rather than branched: a dynamic branch
        // around a texture fetch forces a gradient the hardware cannot
        // compute, so all six happen on every ground fragment even though
        // five of them are multiplied by zero. That is six taps on a single
        // draw call with an overdraw of one, and it was measured rather than
        // assumed -- see the report for the frame-time delta.
        vec3 sand = texture2D(uSand, vGroundUv / uSandTiles).rgb / uSandMean;
        vec3 rock = texture2D(uRock, vGroundUv / uRockTiles).rgb / uRockMean;
        // The ROAD is the one slot that is not rotationally free, and the
        // only one that fetches twice. Its source is a single wheel track
        // running along the image's V axis, so the unrotated sample draws a
        // road running north-south and the coordinate SWAP draws one running
        // east-west. vRoadAxis is the blend between them: 0 north-south,
        // 1 east-west, 0.5 at a corner, a T or a crossroads, where the
        // average of the two is a plus-shaped patch of lane with the gravel
        // left in the four corners -- which is what a junction is. See
        // ground.ts's roadAxisAt for the neighbour rule that picks it.
        //
        // The swap is done here rather than by emitting swapped coordinates
        // in the builder because a junction needs BOTH at once, and a vertex
        // can only carry one pair.
        vec2 roadUv = vGroundUv / uRoadTiles;
        vec3 road = mix(texture2D(uRoad, roadUv).rgb, texture2D(uRoad, roadUv.yx).rgb, vRoadAxis) / uRoadMean;
        vec3 scrub = texture2D(uScrub, vGroundUv / uScrubTiles).rgb / uScrubMean;
        vec3 grove = texture2D(uGrove, vGroundUv / uGroveTiles).rgb / uGroveMean;
        base *= mix(vec3(1.0), sand, uSandStrength * vSandMask);
        base *= mix(vec3(1.0), rock, uRockStrength * vRockMask);
        base *= mix(vec3(1.0), road, uRoadStrength * vRoadMask);
        base *= mix(vec3(1.0), scrub, uScrubStrength * vScrubMask);
        base *= mix(vec3(1.0), grove, uGroveStrength * vGroveMask);
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
