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
 * stopped being true on 2026-09-03, and what `mesh.test.ts` asserts has since
 * moved with the lighting. The three materials below are `MeshStandardMaterial`
 * now, lit and shadowed by `lighting.ts`'s one sun: the slope shade the ground
 * used to compute against its own private light is the scene's job, so the
 * arithmetic identity that kept THAT exemption narrow is gone with it. What
 * `mesh.test.ts` still pins is the five-slot albedo blend, which three.js does
 * not provide and which reaches the GPU through an `onBeforeCompile` string
 * edit -- a seam where every failure is silent and draws a plausible map.
 * Since Task 5 of the ground plan that blend is WEIGHTED by the control map
 * (`control-map.ts`) rather than switched by five per-vertex masks, and sits
 * under the macro field; `controlTextures` below is the one place those two
 * pure grids become GPU data. Since Task 6 the road is not a slot at all: it
 * is drawn from control B's distance field (#226).
 * The palette guarantee on the vertex COLOURS is still proved where it
 * always was, in `ground.test.ts`, on data this consumes unchanged.
 */
import * as THREE from 'three';
import type { MeshData } from './ground';
import { srgbToLinear } from './shared';
import {
  HEIGHT_BLEND,
  MACRO_HUE,
  MACRO_LUMINANCE,
  ROAD_DISTANCE_RANGE_TILES,
  type ControlMap,
  type MacroField,
} from './control-map';
import {
  ROAD_EDGE_BEND,
  ROAD_EDGE_FALLOFF,
  ROAD_GRAIN_TILES,
  ROAD_HALF_WIDTH,
  RUT_ALPHA,
  RUT_JUNCTION_FADE,
  RUT_OFFSET,
  RUT_WIDTH,
  SHOULDER_ALPHA,
  SHOULDER_TILES,
} from './road-graph';

/**
 * Uploads `data`'s positions, colours and indices as a `BufferGeometry`.
 * Non-indexed attributes are never shared between quads (see `ground.ts`'s
 * doc comment on why), so this is a direct, unmodified upload for every
 * attribute except colour: the output pass now encodes to sRGB, so a
 * builder's sRGB palette bytes (`MeshData.colors` -- still asserted as such
 * in `ground.test.ts` and `terrain-parity.test.ts`) are decoded to LINEAR
 * here, on the way to the GPU, via `shared.ts`'s `srgbToLinear`.
 */
export interface GeometryOptions {
  /** What to do when `data.normals` is absent: `'up'` (default) writes
   *  (0, 1, 0) for every vertex -- right for flat ground marks and canopy
   *  billboards, which should light like the ground they stand on;
   *  `'compute'` derives face normals -- right for the extruded structure
   *  boxes, whose walls must shade as walls. */
  normals?: 'up' | 'compute';
}

export function toGeometry(data: MeshData, opts: GeometryOptions = {}): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
  const linear = new Float32Array(data.colors.length);
  for (let i = 0; i < linear.length; i++) linear[i] = srgbToLinear(data.colors[i]);
  geometry.setAttribute('color', new THREE.BufferAttribute(linear, 3));
  geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
  // Wind-sway weight -- see `types.ts`'s own `MeshData.sway` doc comment. No
  // aliased default when absent: only `GroveMaterial` below ever declares a
  // `sway` attribute in its shader, and only `buildGroves`' own output ever
  // sets `data.sway`, so every OTHER terrain sub-mesh (ground/scatter/
  // residual/building-decor, drawn through `vertexColorMaterial` or
  // `GroundMaterial`) simply never has the attribute at all -- correct, since
  // nothing ever reads it there.
  if (data.sway) geometry.setAttribute('sway', new THREE.BufferAttribute(data.sway, 1));
  // Surface normal, three.js's own reserved `normal` name (not a custom one),
  // so the standard material's lighting gets it without anything here
  // declaring `attribute vec3 normal;`. `data.normals` wins when the builder
  // computed one (`ground.ts`'s `buildGround`, whose analytic heightfield
  // normals are smoother than a face average); otherwise every mark still
  // gets a normal -- see `GeometryOptions.normals` above for the
  // up-fill/computed choice.
  if (data.normals) {
    geometry.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
  } else if ((opts.normals ?? 'up') === 'compute') {
    geometry.computeVertexNormals();
  } else {
    const up = new Float32Array(data.positions.length);
    for (let i = 1; i < up.length; i += 3) up[i] = 1;
    geometry.setAttribute('normal', new THREE.BufferAttribute(up, 3));
  }
  // Top or which kind of wall -- the one per-vertex surface fact the shader
  // still reads now the control map carries the surfaces (R-5; `ground.ts`'s
  // `WALL_ALBEDO_*`). The seven per-vertex albedo masks this used to upload
  // alongside it (`sandMask`/`rockMask`/`roadMask`/`roadAxis`/`scrubMask`/
  // `groveMask`/`knollMask`) stopped being read by `GroundMaterial` when
  // Tasks 5 and 6 moved the decision to the control map and the road's
  // distance field; Task 7 is where `ground.ts` stops emitting them, and this
  // is where uploading them stops.
  if (data.wallAlbedo) geometry.setAttribute('wallAlbedo', new THREE.BufferAttribute(data.wallAlbedo, 1));
  // Albedo sampling coordinates. Under a custom name rather than three.js's
  // reserved `uv`, so nothing in three's own shader chunks can be surprised
  // by a `uv` on geometry that has no material expecting one.
  if (data.groundUv) geometry.setAttribute('groundUv', new THREE.BufferAttribute(data.groundUv, 2));
  return geometry;
}

/** Scatter marks, the residual layer and the structure boxes: flat palette
 *  tones from the builders, lit by the scene.
 *
 *  `roughness: 1`, not `world-materials.ts`'s `WORLD_ROUGHNESS` -- these are
 *  dirt, rubble and unfinished blockwork, and the 0.85 that gives a vehicle
 *  hull a faint sheen has no subject here. Ground is the one surface in this
 *  scene that is fully matte, and `GroundMaterial` below agrees with it. */
export function vertexColorMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
}

/**
 * The grove canopy: vertex palette tone, lit, plus the wind offset the
 * retired `groveMaterial` applied -- ported verbatim.
 *
 * This is the consumer `types.ts`'s `MeshData.sway` doc comment and this
 * file's own `toGeometry` comment both already name -- the `sway` attribute
 * existed and was uploaded to the GPU before any material read it, so every
 * tree stood dead still regardless of the per-vertex weight `grove.ts`'s
 * `buildGroves` was already computing. `groveMesh` is the only mesh in
 * `ThreeRenderer.ts` built from this material, and it is the only geometry
 * `toGeometry` ever gives a `sway` attribute to -- see its own comment for
 * why that pairing is exact, not merely conventional.
 *
 * Wind is a pure vertex-stage position offset, so it costs the palette tone
 * nothing: a displaced vertex still carries the exact colour `grove.ts` gave
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
 * Per-vertex phase (`position.x * 0.6 + position.z * 0.9`, both prime-ish
 * irrational-feeling multipliers chosen only to avoid a common period with
 * the other) keeps neighbouring trees out of lockstep without a second
 * per-vertex attribute. It reads OBJECT space where the retired material read
 * a world position, and the two are the same numbers here -- the grove mesh
 * carries no transform (`ThreeRenderer.rebuildTerrain` adds it to the scene
 * untransformed, exactly as it does the ground) -- but object space is the
 * honest one to read inside `begin_vertex`, where the world matrix has not
 * been applied yet. What matters either way is that phase is taken BEFORE the
 * offset, never after: computing it from a position that already includes
 * this same frame's wind would be circular.
 *
 * `uTime` is `ThreeRenderer`'s own accumulated `dtMs` total in seconds --
 * see `ThreeRenderer`'s own `trackClockMs` field doc comment for
 * the identical "accumulated dtMs, never a direct clock read" shape, which
 * keeps this deterministic-enough for a purely cosmetic effect without
 * reading `Date.now()`/`performance.now()` from render code.
 */
export class GroveMaterial extends THREE.MeshStandardMaterial {
  readonly uniforms: { uTime: THREE.IUniform<number> };

  constructor() {
    super({ vertexColors: true, roughness: 1, metalness: 0 });
    this.uniforms = { uTime: { value: 0 } };
    this.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.uniforms.uTime;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float sway;\nuniform float uTime;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
float rlPhase = uTime * 1.6 + position.x * 0.6 + position.z * 0.9;
float rlWind = sin(rlPhase) * sway * 0.05;
transformed += vec3(rlWind, 0.0, -rlWind);`
        );
    };
  }

  override customProgramCacheKey(): string {
    return 'rl-grove';
  }
}

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
 * shipped PNG -- `tools/src/ground-albedo.test.ts` recomputes every one of
 * them from `assets/textures/` and fails if a number here drifts from its
 * file. The texture is applied as a RATIO to it, never as a replacement,
 * which is what keeps this exemption to the VARIATION only (see
 * `GROUND_BLEND_GLSL` below, and `surface.ts`'s
 * `SURFACE_SHADING_EXEMPTION`).
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
 * | knoll_scree_tile   | 3     | .207 | .207   |
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
   * **Not drawn since ground plan Task 6 (#226).** The road is procedural
   * now -- a distance field in control B, three palette tones and the KNOLL
   * image as grain -- and no slot binds this image. The row stays until the
   * asset itself is deleted (the plan's R-7, out of scope), because
   * `tools/src/ground-albedo.test.ts` still measures the shipped file against
   * it; what follows is the record of why it was drawn the way it was.
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
  /**
   * An `n` rocky knoll -- 1,084 tiles across 19 of the 25 shipped maps, and
   * until 2026-09-08 the only ground in the game with no albedo at all.
   *
   * 3, and the two neighbours it was picked against are what fixes it. At 2
   * the chips fall to about 2.5 screen pixels at zoom 1 and the surface
   * reads as fine noise with the tile's own repeat legible as a grid across
   * it -- the same failure the sand tile's doc comment records at that
   * repeat, for the same reason. At 4 the chips reach 8-15 px, which is the
   * size of the four stone blobs `scatter.ts` ALREADY draws on every knoll
   * tile (radius 3-8 px, `DECOR_KNOLL`), so the texture stops being the bed
   * those blobs sit on and starts competing with them. 3 puts a chip at
   * about 5 px: broken stone at the default camera, individual chips when
   * the player leans in, and subordinate to the marks either way.
   *
   * Its raw 0.207 is the highest of the seven and it takes gain 1, which is
   * deliberate rather than a shortfall of ambition. A knoll carries the same
   * `tones.open` wash as the sand beside it -- `groundTone` does not branch
   * on cover, and this work did not change that -- so CONTRAST is the whole
   * of what separates a knoll from open ground, exactly as it is for the
   * three cover tiers. Driving it further only makes the chips louder than
   * the blobs.
   */
  knoll_scree_tile: { tiles: 3, gain: 1, mean: [162.8, 149.5, 135.0] },
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
 * The five albedo SLOTS `GroundMaterial` declares, in the order the fragment
 * shader multiplies them, and the uniform-name stem each one uses
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
 * really has all four uniforms in the shader source -- a slot added to one
 * and not the other is otherwise silent (the uniform is simply never written,
 * and the ground draws its flat tone). Which surface a fragment is ON comes
 * from the control map now, not from a per-slot mask attribute.
 *
 * The road left this list in Task 6 (#226): it is not an image any more but a
 * distance field in control B, painted in palette tones, whose grain borrows
 * the `knoll` slot's sampler -- see `GROUND_BLEND_GLSL`.
 */
export const GROUND_SLOTS = ['sand', 'rock', 'scrub', 'grove', 'knoll'] as const;
export type GroundSlot = (typeof GROUND_SLOTS)[number];

/**
 * The image each slot's `mean` and `tiles` uniforms start at, before any
 * fetch has landed.
 *
 * These are DEFAULTS, not bindings: `ThreeRenderer.loadGroundTexture`
 * overwrites both from `GROUND_ALBEDOS` keyed by the URL it was handed, which
 * is the whole reason that table exists (the open-ground slot takes
 * `desert_sand_tile` on an arid map and `green_basin_tile` on a green one,
 * with different numbers). They still have to be the right image's numbers:
 * until a fetch lands -- or forever, on a map whose tile 404s -- this is what
 * the shader would divide by, and every slot's `strength` is 0 until then
 * precisely so nothing is divided by anything at all.
 */
const DEFAULT_ALBEDO_FOR_SLOT: Record<GroundSlot, GroundAlbedoId> = {
  sand: 'desert_sand_tile',
  rock: 'rock_ground_tile',
  scrub: 'rough_scrub_tile',
  grove: 'orchard_floor_tile',
  knoll: 'knoll_scree_tile',
};

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
 * returns it.
 *
 * `NoColorSpace` -- and this is now the OPPOSITE of what every other map in
 * this renderer gets (`world-materials.ts`'s `prepareTexturedMap` forces
 * `SRGBColorSpace`, because a photographic bake IS a colour and the output
 * pass encodes one). This image is not used as a colour. The blend below
 * divides each texel by the image's own mean, `GROUND_ALBEDOS` measured that
 * mean in raw file BYTES, and the ratio is 1-on-average only while both sides
 * live in the same space. Tag it sRGB and the GPU decodes the texel on every
 * sample while the divisor stays a byte -- which drags the whole ground off
 * the tone `tones.ts` composited and still looks exactly like sand.
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
 * The sampler state every ground DATA texture takes -- control A, control B
 * and the macro field alike (the plan's Global Constraints).
 *
 * `NoColorSpace` for the same reason `prepareGroundTexture` gives the albedo
 * tiles: these bytes are weights and a signed scalar, not colours, and an sRGB
 * tag would have the GPU "decode" a 0.5 blend weight to 0.21. `ClampToEdge`,
 * not repeat: the map does not tile, and a repeat would bleed the far edge's
 * surfaces into the near edge's first half-texel. Mipmapped, because at zoom
 * 0.35 a ground fragment spans several control texels and an unfiltered
 * minification would shimmer the splat edges as the camera pans. `flipY`
 * false: row 0 of every grid is world z = 0, and `vRlWorldXZ / uMapSize`
 * samples v = z / height, so the rows must land in the texture top-first.
 */
function asGroundData(tex: THREE.DataTexture): THREE.DataTexture {
  tex.colorSpace = THREE.NoColorSpace;
  tex.flipY = false;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  // One byte a texel on the macro field: rows are not 4-byte aligned on a
  // 1x1 default, and a wrong alignment skews every row after the first.
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  return tex;
}

/** `data` as a view three's `DataTexture` accepts. The pure grids are typed
 *  over `ArrayBufferLike`, which admits a `SharedArrayBuffer` a texture upload
 *  does not; every one of them is in fact a plain `ArrayBuffer`, so this is a
 *  second VIEW of the same bytes -- no copy -- and copies only in the case
 *  that never happens. */
function uploadable(data: Uint8Array): Uint8Array<ArrayBuffer> {
  const buffer = data.buffer;
  return buffer instanceof ArrayBuffer ? new Uint8Array(buffer, data.byteOffset, data.length) : new Uint8Array(data);
}

/** An RGBA8 control texture over `data`, `width x height` texels. */
function controlTexture(data: Uint8Array, width: number, height: number): THREE.DataTexture {
  return asGroundData(
    new THREE.DataTexture(uploadable(data), width, height, THREE.RGBAFormat, THREE.UnsignedByteType)
  );
}

/** The macro field as an R8 texture -- one byte a texel, 128 neutral. */
export function macroTexture(macro: MacroField): THREE.DataTexture {
  return asGroundData(
    new THREE.DataTexture(uploadable(macro.data), macro.size, macro.size, THREE.RedFormat, THREE.UnsignedByteType)
  );
}

/** Control A and control B as textures, without the macro field -- what
 *  `ThreeRenderer.rebuildTerrain` rebinds when a destroyed structure changes
 *  the ground, since the macro field depends on the map's size alone and is
 *  built once. */
export function controlTexturePair(cm: ControlMap): { a: THREE.DataTexture; b: THREE.DataTexture } {
  return { a: controlTexture(cm.a, cm.width, cm.height), b: controlTexture(cm.b, cm.width, cm.height) };
}

/**
 * Every ground data texture `GroundMaterial` samples, built from the two pure
 * grids `control-map.ts` makes: control A (open, rock, scrub, grove), control
 * B (knoll, road distance, junction distance, road-edge bend) and the macro
 * field, each with `asGroundData`'s sampler state.
 */
export function controlTextures(
  cm: ControlMap,
  macro: MacroField
): { a: THREE.DataTexture; b: THREE.DataTexture; macro: THREE.DataTexture } {
  return { ...controlTexturePair(cm), macro: macroTexture(macro) };
}

/**
 * The 1x1 textures bound before any map lands -- and forever, if building one
 * fails -- each meaning "nothing here": control A `(0,0,0,0)` is no surface
 * weight at all, control B `(0,255,255,128)` is no knoll, no road within
 * range, no junction, neutral bend, and macro `128` is `m = 0`. Every weight
 * zero makes the albedo sum exactly `vec3(1.0)` and a neutral macro is exactly
 * 1, so the ground draws its flat palette tone: the same fail-soft the albedo
 * slots' strength-0 white pixel already gives (`whitePixel`).
 */
function defaultControlA(): THREE.DataTexture {
  return controlTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
}
function defaultControlB(): THREE.DataTexture {
  return controlTexture(new Uint8Array([0, 255, 255, 128]), 1, 1);
}
function defaultMacro(): THREE.DataTexture {
  return macroTexture({ size: 1, data: new Uint8Array([128]) });
}

/**
 * The vertex attributes the ground geometry carries that three.js's own
 * standard shader knows nothing about, and the varyings that hand them to the
 * fragment stage.
 *
 * Declared here rather than in the fragment half below because the two halves
 * must agree exactly: a varying declared in one stage and not the other is a
 * link error, and one declared with a different type is worse -- it links and
 * draws nonsense.
 *
 * The five surface masks are gone from the shader: the control map carries
 * them now, per TEXEL rather than per vertex, which is what lets a surface
 * change fade across a noise-bent band instead of stepping at the tile line
 * (G3). The road's `roadMask` and `roadAxis` went the same way in Task 6: the
 * road is drawn from the distance field control B carries (#226).
 * `wallAlbedo` is the one surface fact a wall still needs per vertex
 * (`ground.ts`'s `WALL_ALBEDO_*`), and `vRlWorldXZ` is where a fragment sits
 * on the map, which is what the control map and the macro field are indexed
 * by.
 */
const GROUND_ATTRIBUTES_GLSL = /* glsl */ `
attribute float wallAlbedo;
attribute vec2 groundUv;
varying float vWallAlbedo;
varying vec2 vGroundUv;
varying vec2 vRlWorldXZ;
`;

/** The fragment half: one quartet of uniforms per `GROUND_SLOTS` entry, the
 *  control map, the macro field and the road, and the receiving end of every
 *  varying above. */
const GROUND_VARYINGS_GLSL = /* glsl */ `
uniform sampler2D uSand; uniform float uSandStrength; uniform vec3 uSandMean; uniform float uSandTiles;
uniform sampler2D uRock; uniform float uRockStrength; uniform vec3 uRockMean; uniform float uRockTiles;
uniform sampler2D uScrub; uniform float uScrubStrength; uniform vec3 uScrubMean; uniform float uScrubTiles;
uniform sampler2D uGrove; uniform float uGroveStrength; uniform vec3 uGroveMean; uniform float uGroveTiles;
uniform sampler2D uKnoll; uniform float uKnollStrength; uniform vec3 uKnollMean; uniform float uKnollTiles;
uniform sampler2D uControlA;
uniform sampler2D uControlB;
uniform sampler2D uMacro;
uniform vec2 uMapSize;
uniform float uMacroAmp;
uniform vec3 uMacroBright;
uniform vec3 uMacroDark;
uniform float uRoadOn;
uniform vec3 uRoadTone;
uniform vec3 uShoulderTone;
uniform vec3 uRutTone;
uniform float uRoadGrainTiles;
uniform float uRoadGrainGain;
varying float vWallAlbedo;
varying vec2 vGroundUv;
varying vec2 vRlWorldXZ;
// One weight's height bias (control-map.ts's heightBiased, before its
// rescale): w + HEIGHT_BLEND * h * 4w(1 - w), h being the Rec. 709 luminance
// deviation of this surface's own strength-scaled texel ratio. A function at
// global scope, so the constant is written once rather than five times.
float rlHeightBiased(float w, vec3 ratio) {
  float h = dot(ratio, vec3(0.2126, 0.7152, 0.0722)) - 1.0;
  return max(0.0, w + ${HEIGHT_BLEND.toFixed(3)} * h * 4.0 * w * (1.0 - w));
}
`;

/**
 * The five-slot albedo blend, WEIGHTED by the control map and multiplied by the
 * macro field, with the road drawn over it from its distance field.
 *
 * Each texel is still a RATIO to its image's own mean, so no surface can move
 * its average off the palette tone the vertex colour carries. What changed is
 * how a fragment picks its surface. It used to be five per-vertex masks, one
 * per surface, mutually exclusive and constant across a tile -- so every
 * surface change was a hard edge at the tile line (G3). Now it is five weights
 * read from control A and B at the fragment's own map position, and the
 * albedo is their weighted sum of ratios:
 *
 *   `1 + sum_i w_i * (mix(1, texel_i/mean_i, strength_i) - 1)`
 *
 * **On every tile interior that is the old chain of mixes, exactly.** There
 * one weight is the tile's own strength and the rest are 0: an open tile's
 * `w = 1` gives `mix(1, sand, s)`, and a cover-1 tile's scrub `w = 0.4` gives
 * `1 + 0.4 * (mix(1, scrub, s) - 1)` = `mix(1, scrub, 0.4 s)` -- today's
 * `strength x mask`. The weights only differ from the masks inside the
 * 0.5-tile edge band, which is the point, and the only interior change is the
 * macro factor below.
 *
 * **Height blend.** Inside a band, each weight is biased by its OWN texel's
 * luminance deviation (`control-map.ts`'s `heightBiased`, transcribed with its
 * `HEIGHT_BLEND`): a bright pebble on the scree beats the dark sand beside it
 * and the edge follows the texture rather than a smooth ramp. The bias reads
 * the strength-scaled ratio, so an image that has not landed has deviation 0
 * and biases nothing. A single non-zero weight is left exactly as it was, by
 * the rescale -- which is what keeps the interior claim above true.
 *
 * **Walls** ignore the map (R-5): a vertical face sits on a texel boundary.
 * `vWallAlbedo` is -1 on a top and is otherwise the wall's rock weight
 * directly -- 1 on a ridge's cliff, 0 on a building's wall.
 *
 * **Macro.** A map-sized scalar `m` in [-1, 1] (`buildMacroField`), applied as
 * `macroFactor` is: a luminance ratio `1 + MACRO_LUMINANCE m` times a small
 * hue pull toward `uMacroBright` or `uMacroDark`, which are `neutralTint`s and
 * so cannot move luminance themselves. The byte decode is the EXACT inverse of
 * the field's `round(128 + 127 v)` encoding, so the 1x1 default of 128 is
 * `m = 0` exactly rather than `r * 2 - 1`'s 0.004. `uMacroAmp` is 1 shipped;
 * 0 removes the field.
 *
 * **The road (#226, spec 3.2)** is not a slot. It is `road-graph.ts`'s
 * `roadProfile` transcribed -- `road-graph.test.ts` is its test -- over the
 * three road channels of control B: distance to the centreline (G), distance
 * to the nearest junction (B) and a signed edge-bend sample (A). Three bands
 * come out of it: the packed SURFACE (1 inside `ROAD_HALF_WIDTH`, softening
 * across `ROAD_EDGE_FALLOFF`, its edge bent by `ROAD_EDGE_BEND`), a bleached
 * SHOULDER just past that edge, and two wheel RUTS at `RUT_OFFSET` either side
 * of the centreline -- one expression, since both read the same unsigned
 * distance -- faded out within `RUT_JUNCTION_FADE` of a junction so a
 * crossroads draws no rings. Because the distance is to a graph whose
 * diagonals are EDGES, a diagonal chain of road tiles draws as one continuous
 * track rather than a string of diamonds (G2), and no tile boundary appears
 * anywhere in the result (G1).
 *   Each band is a palette tone MIXED into `diffuseColor` -- before the ratio
 * multiply below, because the albedo is a ratio to whatever tone is there,
 * and the road's tone has to be that tone. The surface also takes the surface
 * weights beneath it down by `(1 - surface)`, and in their place adds a GRAIN
 * term of its own, in the same mix-from-1.0 ratio form as every slot, so it
 * cannot move the road's average off `uRoadTone`. The grain is the KNOLL
 * image (R-7: one shared image, no road asset), sampled at the road's own
 * repeat in world space; its luminance also breaks the ruts up, which is the
 * spec's "world noise". `uRoadGrainGain` is 0 until that image lands (F-12):
 * before then `uKnoll` is the white pixel, which reads as `1 / uKnollMean`,
 * about 1.6x, and a live gain would brighten every road by that much.
 *   The derived band edges are written as EXPRESSIONS of the tested
 * constants, never as their folded values (the plan's F-3), so a drifted
 * constant in `road-graph.ts` moves the shader with it; the compiler folds
 * the arithmetic. `rlTop` keeps the road off every wall. `uRoadOn` is 1; the
 * `roads` debug layer (Task 9) writes 0.
 *
 * The fetches are unconditional rather than branched: a dynamic branch around
 * a texture fetch forces a gradient the hardware cannot compute, so every tap
 * happens on every ground fragment even where its weight is zero. Six albedo
 * taps (five slots and the road's grain) plus three data taps, on a single
 * draw call with an overdraw of one.
 *
 * `vGroundUv`, not a projection taken from the world position, for the
 * ALBEDO: the builder emits the right planar projection per piece of geometry,
 * because projecting straight down is only correct for a horizontal surface
 * and a cliff face is not one (`MeshData.groundUv`). The control map and the
 * macro field are the opposite case -- they describe the map in plan, so they
 * are indexed by world `xz`.
 *
 * Every local is `rl`-prefixed: this code is spliced into three.js's own
 * `main()`, where a bare `sand` or `road` would be one chunk away from
 * colliding with a name three.js owns. (No backticks anywhere in this shader
 * source: it is a JS template literal and one would close it mid-string.)
 * The three constants are interpolated from the TypeScript exports their
 * mirrors are tested against, never retyped, and `mesh.test.ts` pins that the
 * source contains them -- once each, so a line retyped by hand cannot hide
 * behind a sibling that was not. The luminance weights are Rec. 709, the same
 * three `neutralTint` uses; the height bias lives in `rlHeightBiased`, at
 * global scope in the fragment header, for exactly that once-each reason.
 */
const GROUND_BLEND_GLSL = /* glsl */ `
vec3 rlSand = texture2D(uSand, vGroundUv / uSandTiles).rgb / uSandMean;
vec3 rlRock = texture2D(uRock, vGroundUv / uRockTiles).rgb / uRockMean;
vec3 rlScrub = texture2D(uScrub, vGroundUv / uScrubTiles).rgb / uScrubMean;
vec3 rlGrove = texture2D(uGrove, vGroundUv / uGroveTiles).rgb / uGroveMean;
vec3 rlKnoll = texture2D(uKnoll, vGroundUv / uKnollTiles).rgb / uKnollMean;
vec2 rlCtlUv = vRlWorldXZ / uMapSize;
vec4 rlA = texture2D(uControlA, rlCtlUv);
vec4 rlB = texture2D(uControlB, rlCtlUv);
float rlTop = step(vWallAlbedo, -0.5);
// Five surface weights: open, rock, scrub, grove, knoll. A wall ignores the map.
float rlW0 = rlTop * rlA.r;
float rlW1 = rlTop * rlA.g + (1.0 - rlTop) * max(vWallAlbedo, 0.0);
float rlW2 = rlTop * rlA.b;
float rlW3 = rlTop * rlA.a;
float rlW4 = rlTop * rlB.r;
vec3 rlF0 = mix(vec3(1.0), rlSand, uSandStrength);
vec3 rlF1 = mix(vec3(1.0), rlRock, uRockStrength);
vec3 rlF2 = mix(vec3(1.0), rlScrub, uScrubStrength);
vec3 rlF3 = mix(vec3(1.0), rlGrove, uGroveStrength);
vec3 rlF4 = mix(vec3(1.0), rlKnoll, uKnollStrength);
// Height blend: each weight biased by its own texel's luminance deviation, then rescaled (heightBiased).
float rlB0 = rlHeightBiased(rlW0, rlF0);
float rlB1 = rlHeightBiased(rlW1, rlF1);
float rlB2 = rlHeightBiased(rlW2, rlF2);
float rlB3 = rlHeightBiased(rlW3, rlF3);
float rlB4 = rlHeightBiased(rlW4, rlF4);
float rlBSum = rlB0 + rlB1 + rlB2 + rlB3 + rlB4;
if (rlBSum > 0.0) {
  float rlRescale = (rlW0 + rlW1 + rlW2 + rlW3 + rlW4) / rlBSum;
  rlW0 = rlB0 * rlRescale;
  rlW1 = rlB1 * rlRescale;
  rlW2 = rlB2 * rlRescale;
  rlW3 = rlB3 * rlRescale;
  rlW4 = rlB4 * rlRescale;
}
// The road: roadProfile transcribed (road-graph.test.ts is its test), over control B's G, B and A.
float rlRoadD = rlB.g * ${ROAD_DISTANCE_RANGE_TILES.toFixed(3)};
float rlJuncD = rlB.b * ${ROAD_DISTANCE_RANGE_TILES.toFixed(3)};
float rlRoadE = rlRoadD + ${ROAD_EDGE_BEND.toFixed(3)} * (rlB.a * 2.0 - 1.0);
float rlRoadH0 = (${ROAD_HALF_WIDTH.toFixed(3)} - 0.5 * ${ROAD_EDGE_FALLOFF.toFixed(3)});
float rlRoadH1 = (${ROAD_HALF_WIDTH.toFixed(3)} + 0.5 * ${ROAD_EDGE_FALLOFF.toFixed(3)});
float rlRoadEdge = smoothstep(rlRoadH0, rlRoadH1, rlRoadE);
float rlRoadSurf = uRoadOn * rlTop * (1.0 - rlRoadEdge);
float rlShoulder = uRoadOn * rlTop * ${SHOULDER_ALPHA.toFixed(3)} * rlRoadEdge
  * (1.0 - smoothstep(rlRoadH1, rlRoadH1 + ${SHOULDER_TILES.toFixed(3)}, rlRoadE));
vec3 rlGrain = texture2D(uKnoll, vRlWorldXZ / uRoadGrainTiles).rgb / uKnollMean;
float rlGrainLum = dot(rlGrain, vec3(0.2126, 0.7152, 0.0722));
float rlRut = ${RUT_ALPHA.toFixed(3)}
  * (1.0 - smoothstep((0.5 * ${RUT_WIDTH.toFixed(3)} - 0.010), (0.5 * ${RUT_WIDTH.toFixed(3)} + 0.010), abs(rlRoadD - ${RUT_OFFSET.toFixed(3)})))
  * smoothstep(0.0, ${RUT_JUNCTION_FADE.toFixed(3)}, rlJuncD) * rlRoadSurf
  * smoothstep(0.85, 1.05, rlGrainLum); // broken by the grain: the spec's "world noise"
rlW0 *= (1.0 - rlRoadSurf);
rlW1 *= (1.0 - rlRoadSurf);
rlW2 *= (1.0 - rlRoadSurf);
rlW3 *= (1.0 - rlRoadSurf);
rlW4 *= (1.0 - rlRoadSurf);
diffuseColor.rgb = mix(diffuseColor.rgb, uRoadTone, rlRoadSurf);
diffuseColor.rgb = mix(diffuseColor.rgb, uShoulderTone, rlShoulder);
diffuseColor.rgb = mix(diffuseColor.rgb, uRutTone, rlRut);
vec3 rlAlbedo = vec3(1.0)
  + rlW0 * (rlF0 - 1.0)
  + rlW1 * (rlF1 - 1.0)
  + rlW2 * (rlF2 - 1.0)
  + rlW3 * (rlF3 - 1.0)
  + rlW4 * (rlF4 - 1.0)
  + rlRoadSurf * (mix(vec3(1.0), rlGrain, uRoadGrainGain) - 1.0);
float rlM = (texture2D(uMacro, rlCtlUv).r * 255.0 - 128.0) / 127.0 * uMacroAmp;
vec3 rlMacro = (1.0 + ${MACRO_LUMINANCE.toFixed(3)} * rlM)
  * mix(vec3(1.0), rlM >= 0.0 ? uMacroBright : uMacroDark, ${MACRO_HUE.toFixed(3)} * abs(rlM));
diffuseColor.rgb *= rlAlbedo * rlMacro;
`;

/** One quartet of uniforms per slot, each starting at its own image's numbers
 *  (`DEFAULT_ALBEDO_FOR_SLOT`) with a valid 1x1 sampler bound and a strength
 *  of 0 -- so a map with no texture, or one whose fetch failed, draws the flat
 *  palette tone it always did rather than a white or undefined one. Plus the
 *  control map and the macro field at their "nothing here" defaults
 *  (`defaultControlA` and its siblings), which fail soft the same way, and a
 *  neutral `(1, 1, 1)` hue pull until `ThreeRenderer` resolves the palette's.
 *  The road is on, with white tones until `ThreeRenderer` binds the palette's
 *  -- unseen, since the default control B says no road is within range -- and
 *  its grain gain 0 until the knoll image lands (F-12). */
function groundUniforms(): Record<string, THREE.IUniform> {
  const u: Record<string, THREE.IUniform> = {};
  for (const slot of GROUND_SLOTS) {
    const names = slotUniforms(slot);
    const id = DEFAULT_ALBEDO_FOR_SLOT[slot];
    u[names.map] = { value: whitePixel() };
    u[names.strength] = { value: 0 };
    u[names.mean] = { value: albedoMean(id) };
    u[names.tiles] = { value: GROUND_ALBEDOS[id].tiles };
  }
  u.uControlA = { value: defaultControlA() };
  u.uControlB = { value: defaultControlB() };
  u.uMacro = { value: defaultMacro() };
  u.uMapSize = { value: new THREE.Vector2(1, 1) };
  u.uMacroAmp = { value: 1 };
  u.uMacroBright = { value: new THREE.Vector3(1, 1, 1) };
  u.uMacroDark = { value: new THREE.Vector3(1, 1, 1) };
  u.uRoadOn = { value: 1 };
  u.uRoadTone = { value: new THREE.Vector3(1, 1, 1) };
  u.uShoulderTone = { value: new THREE.Vector3(1, 1, 1) };
  u.uRutTone = { value: new THREE.Vector3(1, 1, 1) };
  u.uRoadGrainTiles = { value: ROAD_GRAIN_TILES };
  u.uRoadGrainGain = { value: 0 };
  return u;
}

/**
 * The drawn ground: `MeshStandardMaterial` with the vertex palette tone
 * multiplied by the five-slot albedo blend, lit and shadowed by the scene.
 *
 * The retired `groundSurfaceMaterial` shaded slopes itself against a private
 * light; the sun does that now, so `GROUND_RELIEF_STRENGTH` and its floor and
 * ceiling are gone with it -- and with them the arithmetic identity
 * (`1 + R * (N.L - up.L)`, exactly 1.0 at an up normal) that used to keep flat
 * ground byte-identical to the unlit path. Nothing is byte-identical to that
 * path any more: the whole scene is lit.
 *
 * The blend is injected AFTER `<color_fragment>`, which is where three.js
 * multiplies the vertex colour into `diffuseColor`. That order is the
 * contract, not a convenience: the albedo has to scale the palette tone rather
 * than stand in for it, because the ratio form is what keeps the surface's
 * average on-palette (`GROUND_ALBEDOS`). Injected before it, the albedo would
 * scale the material's own flat white `color` and the vertex tone would then
 * overwrite the result.
 *
 * `uniforms` is a field on this subclass so `ThreeRenderer.loadGroundTexture`
 * and the `ground-albedo` debug layer keep writing
 * `uniforms.uSandStrength.value` exactly as before; `onBeforeCompile` hands the
 * SAME uniform objects to the program, so a write here is a write the GPU sees.
 *
 * `customProgramCacheKey` replaces three.js's default, which is the callback's
 * own `toString()` -- correct, but a long string rebuilt and compared every
 * time this material is initialised. A constant is cheaper and reads better in
 * a cache key; what it must be is stable per class and DIFFERENT from
 * `GroveMaterial`'s, since the two inject different source into the same two
 * chunks. (three.js appends this to the full parameter hash rather than
 * replacing it, so a constant cannot collapse two genuinely different
 * programs -- a shadow-casting variant, a different light count -- into one.)
 */
export class GroundMaterial extends THREE.MeshStandardMaterial {
  readonly uniforms: Record<string, THREE.IUniform>;

  constructor() {
    // DoubleSide: a heightfield patch turns its back on this camera past
    // ~3.2 levels per tile of slope; measured 0 back faces on every shipped
    // map, but qarn_hadid clears the threshold by a dot product of 0.00001.
    // Culling it would read as a hole, not a lighting bug.
    //
    // The back face's normal IS flipped now, by three.js's own
    // `normal_fragment_begin` (`gl_FrontFacing`), where the retired shader
    // deliberately did not flip it. That reverses on one count: a heightfield
    // normal always points up by construction, so the un-flipped normal is the
    // truthful one. It costs nothing to leave alone -- the triangles in
    // question are edge-on to this camera by definition, which is why they are
    // back-facing at all.
    super({ vertexColors: true, roughness: 1, metalness: 0, side: THREE.DoubleSide });
    this.uniforms = groundUniforms();
    this.onBeforeCompile = (shader) => {
      for (const [name, uniform] of Object.entries(this.uniforms)) shader.uniforms[name] = uniform;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${GROUND_ATTRIBUTES_GLSL}`)
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
vWallAlbedo = wallAlbedo; vGroundUv = groundUv;
vRlWorldXZ = (modelMatrix * vec4(transformed, 1.0)).xz;`
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${GROUND_VARYINGS_GLSL}`)
        .replace('#include <color_fragment>', `#include <color_fragment>\n${GROUND_BLEND_GLSL}`);
    };
  }

  /** Non-null only while the `ground-albedo` debug layer is hidden: the
   *  per-slot strengths `setAlbedoVisible(true)` puts back, in `GROUND_SLOTS`
   *  order, and the road's grain gain after them. */
  private albedoStash: number[] | null = null;
  /** Non-null only while the `macro` debug layer is hidden: the amplitude
   *  `setMacroVisible(true)` puts back. */
  private macroStash: number | null = null;

  /**
   * Backs `setDebugLayerVisible('ground-albedo', ...)`: hidden, every slot's
   * strength goes to 0 -- the material's own fail-soft path, exactly what a
   * 404 leaves behind -- and so does the road's grain gain, which is the
   * KNOLL image's texture term on the road and is what a knoll 404 leaves at
   * 0 (F-12). NOTHING ELSE. The road's palette tones stay: they are the
   * vertex-tone half of the picture, not a texture. The macro field stays
   * on, because a texture that never arrives leaves it on: this layer's check
   * measures "the texture never arrived", and a hide that also removed the
   * macro would credit the macro's contribution to the tiles and keep that
   * check passing on a real 404. A backdrop that needs the ground truly flat
   * (the `scatter` tone check) hides `macro` as well -- see `setMacroVisible`.
   *
   * Idempotent in both directions: hiding twice must not stash a set of
   * zeroes as the value to restore, which would leave the ground permanently
   * flat and make every later toggle read a delta of nothing. Returns how
   * many SLOTS it drove -- the gate prints it as a diagnostic. The grain gain
   * is not counted separately: it is the knoll slot's own image, drawn on
   * the road.
   */
  setAlbedoVisible(visible: boolean): number {
    if (!visible) {
      if (this.albedoStash === null) {
        this.albedoStash = [
          ...GROUND_SLOTS.map((slot) => this.uniforms[slotUniforms(slot).strength].value as number),
          this.uniforms.uRoadGrainGain.value as number,
        ];
      }
      for (const slot of GROUND_SLOTS) this.uniforms[slotUniforms(slot).strength].value = 0;
      this.uniforms.uRoadGrainGain.value = 0;
      return GROUND_SLOTS.length;
    }
    const stash = this.albedoStash;
    if (stash === null) return 0;
    GROUND_SLOTS.forEach((slot, i) => {
      this.uniforms[slotUniforms(slot).strength].value = stash[i];
    });
    this.uniforms.uRoadGrainGain.value = stash[GROUND_SLOTS.length];
    this.albedoStash = null;
    return GROUND_SLOTS.length;
  }

  /**
   * Backs `setDebugLayerVisible('macro', ...)`: `uMacroAmp` to 0 and back,
   * idempotently, the same stash shape as `setAlbedoVisible`. Hidden, the
   * macro factor is exactly `vec3(1.0)` (`macroFactor` at amplitude 0).
   *
   * Its own layer rather than part of `ground-albedo`, because the two
   * answer different questions: `ground-albedo` alone is "the texture never
   * arrived" (the macro survives a 404), and `ground-albedo` + `macro`
   * together are the FLAT vertex palette tone the `scatter` tone check
   * flattens to -- scatter marks carry no macro, so over macro-shaded ground a
   * mark whose colour has collapsed into its tile's tone still differs by the
   * macro factor and the check stops seeing the defect it exists for.
   */
  setMacroVisible(visible: boolean): number {
    if (!visible) {
      if (this.macroStash === null) this.macroStash = this.uniforms.uMacroAmp.value as number;
      this.uniforms.uMacroAmp.value = 0;
      return 1;
    }
    const stash = this.macroStash;
    if (stash === null) return 0;
    this.uniforms.uMacroAmp.value = stash;
    this.macroStash = null;
    return 1;
  }

  override customProgramCacheKey(): string {
    return 'rl-ground';
  }
}
