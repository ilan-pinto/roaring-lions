/**
 * The interpolated ground surface: one height field, sampled by everything
 * that has to touch the ground.
 *
 * ## What changed, and what did not
 *
 * `ground.ts` used to draw a tile top as a flat quad at its own integer
 * height -- "terraces, not ramps" -- and everything that stands on the
 * ground (`ground-height.ts`, `decor-place.ts`, `scatter.ts`'s marks) read
 * the same integer. That was right when three.js owed Pixi parity and when
 * the 42-colour palette guarantee had to hold for every pixel of the frame.
 * Neither is true now (see this module's `SURFACE_SHADING_EXEMPTION`), and
 * the project lead's own reading of the result was "the hills look more like
 * stairs".
 *
 * **The sim is untouched, and that is the property that makes this safe.**
 * `flowfield.ts` prices a climb from `elevation[tile] - elevation[n]`;
 * `sim.ts` computes line of sight from `elevation[...] + EYE_HEIGHT`;
 * `raySmoke` reads it the same way. None of them know how the ground is
 * DRAWN. This is the spatial twin of interpolating a unit's position to 60
 * fps while the sim ticks at 20: the renderer shows a continuous quantity,
 * the sim decides on a discrete one, and they are required to agree only at
 * the sample points -- which they do, exactly (see `INTERPOLATION` below).
 *
 * ## The interpolation: Catmull-Rom over TILE CENTRES, not corners
 *
 * Two choices had to be made and both are load-bearing.
 *
 * **Where the samples live.** The obvious move -- average the four tiles
 * around each tile CORNER, then bilinear across the tile -- is wrong here,
 * and not subtly. Averaging is a low-pass: a lone tile at level 3 in a sea
 * of level 0 comes out with four corners at 0.75 and a centre at 0.75, so
 * the drawn ground sits at a QUARTER of the height the sim charges a climb
 * for. Treating the grid as samples at tile CENTRES and interpolating
 * between them instead makes the surface pass exactly through every
 * authored level: `surfaceLevel(s, x + 0.5, y + 0.5)` is `elevation[y * w +
 * x]` to the bit, for every tile on every map. A unit standing at a tile
 * centre stands at exactly the height it stood at before this module
 * existed, and `pnpm test:determinism` cannot notice a renderer change
 * anyway -- but the visual claim "the drawn ground agrees with the sim
 * where the sim actually looks" is worth having, and `surface.test.ts`
 * pins it.
 *
 * **Which interpolant.** Bilinear between centres is C0: continuous in
 * height, discontinuous in SLOPE across every line joining two centres. The
 * toon look here is driven off the surface normal (`mesh.ts`'s
 * `groundSurfaceMaterial`), and a normal field with a crease every tile
 * draws a diamond lattice of shading seams -- pyramids, which is a
 * different wrong answer to the same question stairs were. Catmull-Rom is
 * C1 and interpolating: smooth normals everywhere AND exact at the samples.
 * The cost is overshoot at a sharp step (~6.25% of the step), which is why
 * the terrace rule below exists at all -- every step sharp enough to
 * overshoot visibly on a shipped map is a cliff, and cliffs are excluded.
 *
 * ## The terrace rule: `blocked` is a wall, everything else is a hill
 *
 * A tile is drawn as a FLAT TERRACE at its own integer height, exactly as
 * before this module, if and only if `blocked[tile] !== 0`. That is one
 * rule covering the two cases that need it, and it is the sim's own mask
 * rather than a second opinion about the map:
 *
 *  - `^` rock ridge. Impassable and sight-blocking -- a cliff face, not a
 *    hill. Tel Marum's corridor walls and Qarn Hadid's massif are the
 *    shapes the `relief` golden scenario frames, and rounding them off
 *    would turn a wall into a slope the player can see is not a slope.
 *  - Building footprints. `mesh-building.ts` leaves a building's rotation
 *    at identity and `buildings.ts` puts its box base at
 *    `levelAt(x, y) * WORLD_PER_LEVEL`; tilting the pad underneath would
 *    float one corner of every structure on every slope. A building stands
 *    on a level pad because it was built on one.
 *
 * `b` boulder fields and `d` ditches are deliberately NOT terraces: both are
 * vehicle-only masks on ground infantry walks over, and `map.ts`'s own
 * legend gives them `blocked: 0`. Ground a man can cross is ground that
 * ramps.
 *
 * The terrace tiles are also cut OUT of the smoothing source (see
 * `buildTerrainSurface`), which is what keeps the open ground beside a
 * cliff level right up to the cliff foot instead of ramping a third of the
 * way up it.
 *
 * ## A map with no elevation grid is not touched at all
 *
 * Four of the six shipped maps have no `elevation` key. For those, `levels`
 * is null, `flat` is true, and every query here returns 0 -- and `ground.ts`
 * takes its own fast path and emits the pre-existing two-triangle flat quad
 * per tile, unchanged. That is not an optimisation: it is what makes
 * "nothing moved on a flat map" a property of the code rather than a claim
 * about floating point, and it is why the `quiet`, `open-ground` and
 * `vehicle` golden scenarios are expected to read 0 px / 0.0000 across this
 * change while `relief` moves wholesale.
 */
import { WORLD_PER_LEVEL } from './shared';
import type { TerrainInput } from './types';

/** Never mutated, never indexed -- `buildTerrainSurface` reads `blocked` and
 *  `elevation` only, so `terrainSurfaceFrom` fills `TerrainInput`'s other
 *  required field from one shared empty array rather than allocating per
 *  call. Same shape `ground-height.ts` has always used for the same reason. */
const EMPTY_BYTES = new Uint8Array(0);

/**
 * How many segments each smooth tile is cut into, per axis.
 *
 * The SHADING is already exact without any subdivision at all -- normals
 * are analytic (`surfaceNormal`), not face-averaged, so a single quad per
 * tile would still carry a correct normal at each of its corners. What
 * subdivision buys is the SILHOUETTE and the interior of the quad: a hill
 * drawn as one stretched quad per tile is a faceted polyhedron whose edges
 * are visible against the sky and whose interior is a flat plane the
 * interpolated normal lies about.
 *
 * 4 puts 4 segments across a tile, so the 5-to-8-tile landforms Qarn Hadid
 * is authored around (the Hollow's rim, the massif's shoulder) get 20-32
 * segments across their span. Costs 32 triangles per smooth tile against 2
 * before -- see this module's own report for the measured whole-map figure,
 * which is one draw call either way.
 */
export const SURFACE_SUBDIVISIONS = 4;

/**
 * How far, in elevation levels, the interpolated surface may run past the
 * authored range -- above the highest sample it interpolates and below the
 * lowest.
 *
 * Catmull-Rom is C1 and interpolating, and the price of both is overshoot at
 * a sharp step: it approaches its samples with a slope set by their
 * neighbours, so it swings past on the way in. There is no way to have
 * smooth normals AND exact samples AND no overshoot; a monotone spline
 * (PCHIP) would buy the third by flattening the derivative at every sample,
 * which reintroduces a shading terrace at every tile centre -- the defect
 * this whole module exists to remove.
 *
 * MEASURED, not derived: about 7.0-7.5% of the step's own height. A
 * synthetic 3-level step reaches 0.2109 levels over
 * (`ground.test.ts`); on real data `qarn_hadid` runs 0.1454 levels below
 * zero and `tel_marum` 0.2242, and the steepest step between two adjacent
 * OPEN tiles on either map is 3 levels. 0.30 is that worst case rounded up
 * to what a 4-level open step would produce, which is more relief than
 * either map authors on walkable ground.
 *
 * This is why `terrain-parity.test.ts` can no longer assert `minY >= 0` on a
 * relief map. It is a few thousandths of a world unit -- 0.077 at
 * `WORLD_PER_LEVEL` -- and it costs nothing visually: a rim wall is drawn
 * from the surface DOWN, so ground that dips below zero simply draws no rim
 * wall there rather than drawing an inverted one.
 */
export const SURFACE_OVERSHOOT_LEVELS = 0.3;

/**
 * The one thing on the drawn ground that is NOT a `data/palette.json`
 * entry, named here so it appears on the passing path of every gate that
 * asks.
 *
 * This is the fourth named exemption from the palette, and it is written to
 * the same shape as the three that came before it -- textured buildings
 * (`TEXTURED_BUILDING_TYPES`), the ditch (`TEXTURED_DECOR_FAMILIES`) and the
 * campaign board (`three/campaign/`). A named list, visible on the passing
 * path, never a silently weakened check.
 *
 * **What is exempt: the fragment, and only on the interpolated surface.**
 * ONE exemption covering TWO multiplies, both in `groundSurfaceMaterial` and
 * both on the same geometry:
 *
 *  - A smooth shade term derived from the surface normal, so a hillside's lit
 *    and shaded flanks land between palette entries. That is the entire point
 *    -- an unlit vertex-coloured heightfield under an orthographic camera is
 *    indistinguishable from flat ground, so removing the terrace edges
 *    without adding a normal-driven term would have made the map read
 *    FLATTER, not rounder.
 *  - The ground ALBEDO, `assets/textures/desert_sand_tile.png` on open ground
 *    and `rock_ground_tile.png` on a `^` ridge, applied as a ratio to its own
 *    mean
 *    (`mesh.ts`'s `GROUND_TEXTURE_MEAN`). The ratio form is what keeps the
 *    exemption to the variation only: the AVERAGE of a stretch of open ground
 *    is still exactly its `data/palette.json` tone, so a road, a cover tile
 *    and open ground relate to each other exactly as `tones.ts` composited
 *    them.
 *
 * They are one named thing and not two because they are the same decision
 * about the same pixels: this ground is material and light rather than a flat
 * fill, and neither half is legible without the other -- a texture with no
 * normal shading reads as a rug on a flat floor, and shading with no texture
 * reads as a smooth plastic dune.
 *
 * **What is NOT exempt, and is still asserted directly:**
 *
 *  1. Every vertex colour `buildGround` emits is still a palette entry, and
 *     so is every `litColors` entry. `ground.test.ts` and
 *     `terrain-parity.test.ts` both still walk them, unchanged. The tone
 *     pipeline (`tones.ts`) was not touched by this work at all.
 *  1b. A ROAD (`DECOR_ROAD`) is drawn as an interpolated patch like the
 *     ground either side of it, and is masked OUT of the albedo
 *     (`MeshData.sandMask`) so its authored tone still reads as a road
 *     rather than as sand with a rut on it. It keeps the normal shading --
 *     a road over a hill is still over a hill.
 *  2. Terrace tops and terrace/rim walls carry the UP normal deliberately
 *     (`ground.ts`), so the shade term evaluates to exactly 1.0 there and
 *     their fragments are the same palette bytes they have always been. A
 *     ridge face is exempt from nothing.
 *  3. The SHADE, specifically, is exactly 1.0 on flat ground -- every tile of
 *     a map with no relief, and every level patch of a map with one -- because
 *     they carry the same up normal. The shading half of this exemption is
 *     scoped to ground that is actually sloped, and that is what makes it
 *     impossible for smoothing to re-tone a map that has nothing to smooth.
 *
 *     Flat ground does take the sand ALBEDO, and that is a deliberate
 *     reversal. It was held out at first, which kept three golden baselines
 *     at a literal zero; the project lead overruled it, because the default
 *     sandbox map is a flat one and holding it out would have greeted a
 *     player with untextured palette ground while the two relief maps were
 *     sand. Flat sand is still sand. The albedo half of the exemption is
 *     therefore scoped to OPEN GROUND, on any map, sloped or not.
 *
 * `mesh.test.ts` pins 2 and 3 against the shader source, and
 * `surface.test.ts` pins that the shade term is exactly 1 at an up normal
 * rather than merely close to it.
 */
export const SURFACE_SHADING_EXEMPTION = {
  what: 'the drawn ground, at the fragment stage only: a smooth normal-driven shade on INTERPOLATED open ground, and a sampled albedo on ALL open ground (desert_sand_tile) and on a ^ ridge (rock_ground_tile)',
  why: 'an unlit vertex-coloured heightfield reads flat; the normal-driven shade and the two albedos are what make relief and material legible',
  notExempt: [
    'every vertex colour and litColor emitted by buildGround (still asserted palette-only)',
    'terrace tops and terrace/rim walls (up normal, shade exactly 1.0, and no albedo unless the terrace is a ^ ridge)',
    'flat ground shading on any map (up normal, so the shade term is exactly 1.0 -- flat ground still takes the sand albedo)',
    'road tiles (no albedo, so the authored road tone still reads as a road)',
    'building footprints (no albedo, so groundTone underBuilding wash still owns that ground)',
    'scatter marks, groves, building boxes and the residual layer (drawn through the unlit terrainMaterial, untouched)',
  ],
} as const;

/**
 * A map's drawn ground, precomputed once per terrain rebuild.
 *
 * Built by `buildTerrainSurface` from a `TerrainInput` (the terrain
 * builders' own view) and, in `ThreeRenderer`, from the same `elevation`
 * grid and the same `sim.blocked` -- `surface.test.ts` pins that the two
 * routes produce the same field, because a renderer whose units stand on a
 * different surface than the one it draws is the exact failure this type
 * exists to make impossible.
 */
export interface TerrainSurface {
  readonly width: number;
  readonly height: number;
  /** The sim's own integer grid, verbatim, or null for a map with no
   *  elevation at all. Carried here so the one or two callers that genuinely
   *  need the raw grid (`composeTerrain`, `buildBuildings`) can reach it
   *  without a second field travelling beside this one. */
  readonly levels: Uint8Array | null;
  /** 1 where the tile is drawn as a flat terrace -- `blocked[tile] !== 0`.
   *  Empty (length 0) when `flat`. */
  readonly terrace: Uint8Array;
  /** The smoothing source: one float LEVEL per tile, terrace tiles replaced
   *  by their open neighbours' own levels (see `buildTerrainSurface`).
   *  Empty (length 0) when `flat`. */
  readonly field: Float32Array;
  /** True when there is no elevation grid at all. Every query returns 0 and
   *  `ground.ts` draws the pre-existing flat quad per tile. */
  readonly flat: boolean;
}

function isAllZero(a: Uint8Array): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== 0) return false;
  return true;
}

/** Catmull-Rom through `p1`/`p2` at `t` in [0, 1], with `p0`/`p3` as the
 *  slope-setting neighbours. At `t = 0` this returns `p1` EXACTLY -- `0.5 *
 *  (2 * p1)` is exact in binary floating point -- which is the whole reason
 *  a tile centre reads back its own authored level to the bit. */
function catmull(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const a = -p0 + p2;
  const b = 2 * p0 - 5 * p1 + 4 * p2 - p3;
  const c = -p0 + 3 * p1 - 3 * p2 + p3;
  return 0.5 * (2 * p1 + a * t + b * t * t + c * t * t * t);
}

/** d/dt of `catmull`, same arguments. Used for the analytic surface normal
 *  -- face-averaged normals would need shared vertices across tile
 *  boundaries, which would smear each tile's own flat colour into its
 *  neighbour's and take the road tones with it. */
function catmullSlope(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const a = -p0 + p2;
  const b = 2 * p0 - 5 * p1 + 4 * p2 - p3;
  const c = -p0 + 3 * p1 - 3 * p2 + p3;
  return 0.5 * (a + 2 * b * t + 3 * c * t * t);
}

/** `field` at tile `(x, y)`, clamped to the map rather than falling to 0 off
 *  it. Replication, not zero-fill: a rim tile's own top must stay at its
 *  authored level and drop to 0 down a rim WALL, which is what
 *  `buildGround` has always drawn there. Zero-filling instead would ramp the
 *  whole border of every relief map down to sea level. */
function fieldAt(s: TerrainSurface, x: number, y: number): number {
  const cx = x < 0 ? 0 : x >= s.width ? s.width - 1 : x;
  const cy = y < 0 ? 0 : y >= s.height ? s.height - 1 : y;
  return s.field[cy * s.width + cx];
}

/**
 * The smooth field alone, in LEVEL units, with no terrace dispatch: the
 * Catmull-Rom surface evaluated at world point `(x, z)`.
 *
 * This is what `ground.ts` builds a smooth tile's own vertices from, and it
 * is deliberately NOT `surfaceLevel` below. A smooth tile's edge vertices
 * sit exactly ON the boundary with its neighbour; asking the
 * tile-dispatching query there would floor into the neighbour and, if that
 * neighbour is a cliff, snap the hillside's edge up to the cliff top. Two
 * adjacent smooth tiles evaluate this same pure function at the same points
 * and therefore agree to the bit along their shared edge -- which is why
 * sharing no vertices between tiles still leaves no crack.
 */
export function smoothLevel(s: TerrainSurface, x: number, z: number): number {
  if (s.flat) return 0;
  // Samples live at tile CENTRES, so tile index i sits at world x = i + 0.5.
  const u = x - 0.5;
  const v = z - 0.5;
  const i = Math.floor(u);
  const j = Math.floor(v);
  const tu = u - i;
  const tv = v - j;
  let r0 = 0;
  let r1 = 0;
  let r2 = 0;
  let r3 = 0;
  for (let k = 0; k < 4; k++) {
    const row = catmull(
      fieldAt(s, i - 1, j - 1 + k),
      fieldAt(s, i, j - 1 + k),
      fieldAt(s, i + 1, j - 1 + k),
      fieldAt(s, i + 2, j - 1 + k),
      tu
    );
    if (k === 0) r0 = row;
    else if (k === 1) r1 = row;
    else if (k === 2) r2 = row;
    else r3 = row;
  }
  return catmull(r0, r1, r2, r3, tv);
}

/**
 * The drawn ground's LEVEL at world point `(x, z)` -- terrace dispatch
 * included, and therefore the query every consumer outside `ground.ts`
 * wants.
 *
 * Off the map returns 0, matching `levelAt`'s own long-standing rule (and
 * therefore `groundLevelAt`'s, which used to be a thin adapter over it).
 * Inside a terrace tile returns that tile's integer level exactly, so a
 * slab of ridge decor and a structure's own box base still agree with the
 * flat top `buildGround` draws there. Everywhere else, the smooth field.
 */
export function surfaceLevel(s: TerrainSurface, x: number, z: number): number {
  if (s.flat) return 0;
  const tx = Math.floor(x);
  const ty = Math.floor(z);
  if (tx < 0 || tx >= s.width || ty < 0 || ty >= s.height) return 0;
  const t = ty * s.width + tx;
  if (s.terrace[t] !== 0) return s.levels ? s.levels[t] : 0;
  return smoothLevel(s, x, z);
}

/** `surfaceLevel` in three.js world Y, through `WORLD_PER_LEVEL` -- never an
 *  independently-tuned conversion, the same reason `groundWorldY` has always
 *  gone through it. */
export function surfaceWorldY(s: TerrainSurface, x: number, z: number): number {
  return surfaceLevel(s, x, z) * WORLD_PER_LEVEL;
}

/** `smoothLevel` in world Y. `ground.ts`'s smooth vertices only. */
export function smoothWorldY(s: TerrainSurface, x: number, z: number): number {
  return smoothLevel(s, x, z) * WORLD_PER_LEVEL;
}

/**
 * The unit normal of the smooth surface at `(x, z)`, in three.js world
 * space -- analytic, from Catmull-Rom's own derivative, never from
 * averaging face normals.
 *
 * Analytic because the geometry deliberately shares no vertices between
 * tiles (each tile keeps its own flat, on-palette colour; a shared vertex
 * would interpolate a road tone into the open ground beside it). Two
 * adjacent tiles' boundary vertices therefore sit at the same position with
 * the same normal, so shading crosses a tile boundary with no seam even
 * though colour does not.
 */
export function smoothNormal(s: TerrainSurface, x: number, z: number): [number, number, number] {
  if (s.flat) return [0, 1, 0];
  const u = x - 0.5;
  const v = z - 0.5;
  const i = Math.floor(u);
  const j = Math.floor(v);
  const tu = u - i;
  const tv = v - j;
  const rows: number[] = [0, 0, 0, 0];
  const rowSlopes: number[] = [0, 0, 0, 0];
  for (let k = 0; k < 4; k++) {
    const p0 = fieldAt(s, i - 1, j - 1 + k);
    const p1 = fieldAt(s, i, j - 1 + k);
    const p2 = fieldAt(s, i + 1, j - 1 + k);
    const p3 = fieldAt(s, i + 2, j - 1 + k);
    rows[k] = catmull(p0, p1, p2, p3, tu);
    rowSlopes[k] = catmullSlope(p0, p1, p2, p3, tu);
  }
  // dLevel/dx: interpolate the four rows' own u-derivatives across v.
  // dLevel/dz: differentiate the v-interpolation of the four row values.
  const dLdx = catmull(rowSlopes[0], rowSlopes[1], rowSlopes[2], rowSlopes[3], tv);
  const dLdz = catmullSlope(rows[0], rows[1], rows[2], rows[3], tv);
  const nx = -dLdx * WORLD_PER_LEVEL;
  const nz = -dLdz * WORLD_PER_LEVEL;
  const len = Math.hypot(nx, 1, nz);
  return [nx / len, 1 / len, nz / len];
}

/** A wall shorter than this many levels is not drawn: below it the strip is
 *  a sub-pixel sliver at every zoom this camera clamps to (0.35-2.5), and
 *  emitting one for every float wobble along a smooth/terrace seam would
 *  add two triangles per subdivision segment for nothing. 1/64 of a level is
 *  0.004 world units, the same order as `DITCH_LIFT`. */
export const WALL_EPSILON_LEVELS = 1 / 64;

/** Highest (`wantMax`) or lowest smooth level along tile `(x, y)`'s east
 *  (`axis` 0) or south (`axis` 1) edge, sampled at the same
 *  `SURFACE_SUBDIVISIONS + 1` points the wall strip itself uses. Both tiles
 *  sharing the edge sample the same points, which is the point. */
function edgeExtreme(s: TerrainSurface, x: number, y: number, axis: 0 | 1, wantMax: boolean): number {
  let best = wantMax ? -Infinity : Infinity;
  for (let k = 0; k <= SURFACE_SUBDIVISIONS; k++) {
    const f = k / SURFACE_SUBDIVISIONS;
    const px = axis === 0 ? x + 1 : x + f;
    const pz = axis === 0 ? y + f : y + 1;
    const l = smoothLevel(s, px, pz);
    if (wantMax ? l > best : l < best) best = l;
  }
  return best;
}

/**
 * The DRAWN surface's normal at `(x, z)` -- terrace dispatch included, and
 * therefore the query every consumer outside `ground.ts` wants, the same way
 * `surfaceLevel` is for height.
 *
 * Exactly `(0, 1, 0)` on a terrace, off the map and on a flat map, which is
 * what lets a caller that leans on the up normal (`scatter.ts` drapes a
 * ground mark on the tangent plane this returns) reproduce its
 * pre-2026-09-03 output bit for bit on all four flat maps and on every ridge
 * top.
 */
export function surfaceNormal(s: TerrainSurface, x: number, z: number): [number, number, number] {
  if (s.flat) return UP;
  const tx = Math.floor(x);
  const ty = Math.floor(z);
  if (tx < 0 || tx >= s.width || ty < 0 || ty >= s.height) return UP;
  if (s.terrace[ty * s.width + tx] !== 0) return UP;
  return smoothNormal(s, x, z);
}

const UP: [number, number, number] = [0, 1, 0];

/**
 * The steepest gradient, in world Y per world unit, a flat ground DECAL is
 * allowed to be tilted to.
 *
 * A decal (a scatter mark, a road rut, a scree fleck) is draped on the
 * ground's own tangent plane so it lies ON a hillside rather than cutting
 * through it. Left unbounded that can tip the quad past the point where it
 * faces the camera at all: this camera's pitch is 30 degrees
 * (`ELEVATION = asin(TILE_H / TILE_W)`), so a plane whose gradient sums to
 * more than `cos(30)/sqrt(2) / sin(30)` -- 0.8165 -- turns its back, and
 * `terrainMaterial` is `FrontSide`, so the decal would simply vanish. The
 * ground under it does not, because `groundSurfaceMaterial` is `DoubleSide`,
 * so the failure reads as bald patches on the steepest slopes.
 *
 * 0.65 keeps a comfortable margin under 0.8165 and is well above anything a
 * shipped map reaches: measured, `qarn_hadid`'s steepest open ground is 3.75
 * levels per tile and `tel_marum`'s 4.01, which at `WORLD_PER_LEVEL` are
 * gradients of 0.96 and 1.02 -- so the clamp DOES engage on the steepest
 * handful of tiles on both maps, and a mark there lies slightly flatter than
 * the ground beneath it rather than disappearing.
 */
export const MARK_SLOPE_LIMIT = 0.65;

/**
 * The tangent plane a ground decal centred at `(x, z)` should lie on:
 * `y = centreY + gx * dx + gz * dz` for a corner offset `(dx, dz)` from that
 * centre, with the gradient clamped to `MARK_SLOPE_LIMIT`.
 *
 * Planar rather than per-corner-sampled, deliberately. Sampling each corner
 * independently conforms marginally better to a curved surface and gives up
 * the one property that matters more: a plane's orientation is decided by
 * one gradient, so clamping that gradient makes "this decal always faces the
 * camera" true by construction rather than true on the maps measured so far.
 * A per-corner drape was measured producing a back-facing mark on a 4-level
 * synthetic stair, which is steeper than either shipped map but not by much.
 */
export function markPlane(
  s: TerrainSurface,
  x: number,
  z: number
): { centerY: number; gx: number; gz: number } {
  const centerY = surfaceWorldY(s, x, z);
  const n = surfaceNormal(s, x, z);
  // `0 - x` rather than `-x`: on flat ground `n[0]` is +0, and unary minus
  // would hand back NEGATIVE zero. Harmless in the arithmetic that follows
  // and confusing in anything that prints or compares the plane.
  let gx = 0 - n[0] / n[1];
  let gz = 0 - n[2] / n[1];
  const reach = Math.abs(gx) + Math.abs(gz);
  if (reach > MARK_SLOPE_LIMIT) {
    const k = MARK_SLOPE_LIMIT / reach;
    gx *= k;
    gz *= k;
  }
  return { centerY, gx, gz };
}

/** True where `buildGround` draws a flat terrace rather than a hillside. Off
 *  the map is false -- there is no tile there to be flat. */
export function isTerrace(s: TerrainSurface, x: number, y: number): boolean {
  if (s.flat) return false;
  if (x < 0 || x >= s.width || y < 0 || y >= s.height) return false;
  return s.terrace[y * s.width + x] !== 0;
}

/**
 * Whether the shared edge between tile `(x, y)` and its east (`axis` 0) or
 * south (`axis` 1) neighbour carries a wall.
 *
 * The single predicate `ground.ts` emits wall geometry from and
 * `scatter.ts` dresses a slope face from, so the two cannot disagree: a
 * strata band or a lit top edge floating in mid-air over a hillside with no
 * wall under it is exactly what a second copy of this rule would have
 * produced.
 *
 * A wall exists only where at least one side is a terrace, or where the
 * edge leaves the map. Two SMOOTH tiles evaluate the same `smoothLevel`
 * along their shared edge and are continuous across it by construction, so
 * there is nothing to close.
 */
export function hasWall(s: TerrainSurface, x: number, y: number, axis: 0 | 1): boolean {
  if (s.flat) return false;
  const nx = axis === 0 ? x + 1 : x;
  const ny = axis === 0 ? y : y + 1;
  const offMap = nx < 0 || nx >= s.width || ny < 0 || ny >= s.height;
  const here = isTerrace(s, x, y);
  const there = !offMap && isTerrace(s, nx, ny);
  if (!here && !there && !offMap) return false;
  // A wall is only VISIBLE (and only ever drawn, since Phase B2) where this
  // tile stands above its neighbour: the camera looks from +X/+Y/+Z, so a
  // west- or north-facing wall is hidden behind the block that owns it.
  const topHere = here
    ? (s.levels ? s.levels[y * s.width + x] : 0)
    : edgeExtreme(s, x, y, axis, true);
  const bottomThere = offMap
    ? 0
    : there
      ? (s.levels ? s.levels[ny * s.width + nx] : 0)
      : edgeExtreme(s, x, y, axis, false);
  return topHere > bottomThere + WALL_EPSILON_LEVELS;
}

/**
 * Builds the surface from a terrain builder's own view of the map.
 *
 * The smoothing source `field` is the elevation grid with every TERRACE
 * tile replaced by the mean of its open 4-neighbours' own field values,
 * spread outward until no terrace tile is left unfilled (a terrace tile
 * deep inside a massif takes several passes to reach). A map that is
 * terrace end to end has no open tile to spread from at all, and those
 * tiles keep their own level.
 *
 * Replacing rather than keeping the terrace's own height is what makes the
 * rule mean anything: Catmull-Rom has a two-tile support, so leaving a
 * ridge at level 7 in the field would tip the open ground two tiles either
 * side of it a third of the way up the cliff, and the hillside would meet
 * the wall part-way rather than at its foot. Filled from the open ground,
 * the field is locally flat across the cliff and the open ground stays at
 * its own authored level right up to the base of the wall.
 */
export function buildTerrainSurface(input: TerrainInput): TerrainSurface {
  const { width, height, elevation, blocked } = input;
  // "No relief" is an all-zero GRID as often as it is a missing one, and
  // getting that wrong would have silently smoothed four maps that have
  // nothing to smooth. `parseMap` ALWAYS returns a `Uint8Array` -- zero-
  // filled when the map JSON carries no `elevation` key, which is the case
  // for `beit_sahwan_outskirts`, `marj_perimeter`, `tutorial_ground` and
  // `wadi_halam_basin`, four of the six shipped maps. A null check alone
  // would therefore have fired for exactly nothing in production while
  // reading, in a test fixture, as though it fired for most of the game.
  //
  // All-zero rather than all-EQUAL, deliberately: `levelAt` reads off-map as
  // 0, so a uniformly-zero map is the one case where the pre-existing mesh
  // is identical with no rim faces either. A hypothetical uniformly-raised
  // map would need its rim walls and is correctly handled by the general
  // path below.
  if (!elevation || isAllZero(elevation)) {
    return {
      width,
      height,
      levels: elevation ?? null,
      terrace: new Uint8Array(0),
      field: new Float32Array(0),
      flat: true,
    };
  }
  const n = width * height;
  const terrace = new Uint8Array(n);
  const field = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    terrace[i] = blocked[i] !== 0 ? 1 : 0;
    field[i] = elevation[i];
  }

  // Spread open ground into the terraces. `filled` starts as "not a
  // terrace"; each pass fills every unfilled terrace tile that touches a
  // filled one, from the mean of those filled neighbours. Bounded by the
  // map's own diameter, and it exits as soon as a pass fills nothing --
  // an all-terrace map leaves every tile at its own authored level.
  const filled = new Uint8Array(n);
  for (let i = 0; i < n; i++) filled[i] = terrace[i] === 0 ? 1 : 0;
  for (let pass = 0; pass < width + height; pass++) {
    let changed = 0;
    const next = new Float32Array(field);
    const nextFilled = new Uint8Array(filled);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const t = y * width + x;
        if (filled[t] !== 0) continue;
        let sum = 0;
        let count = 0;
        if (x > 0 && filled[t - 1] !== 0) {
          sum += field[t - 1];
          count++;
        }
        if (x + 1 < width && filled[t + 1] !== 0) {
          sum += field[t + 1];
          count++;
        }
        if (y > 0 && filled[t - width] !== 0) {
          sum += field[t - width];
          count++;
        }
        if (y + 1 < height && filled[t + width] !== 0) {
          sum += field[t + width];
          count++;
        }
        if (count === 0) continue;
        next[t] = sum / count;
        nextFilled[t] = 1;
        changed++;
      }
    }
    if (changed === 0) break;
    field.set(next);
    filled.set(nextFilled);
  }

  return { width, height, levels: elevation, terrace, field, flat: false };
}

/**
 * `buildTerrainSurface` from the two arrays `ThreeRenderer` actually holds.
 *
 * Deliberately a thin adapter over the same function rather than a second
 * implementation: `levelAt` is imported here purely so this module's own
 * `TerrainInput` shape stays honest about what a builder reads, and
 * `surface.test.ts` pins that both routes produce the identical field on
 * every shipped map. A renderer that drew one surface and stood its units
 * on another would look right in a screenshot and be wrong in play.
 */
export function terrainSurfaceFrom(
  elevation: Uint8Array | null,
  blocked: Uint8Array,
  width: number,
  height: number
): TerrainSurface {
  return buildTerrainSurface({
    width,
    height,
    decor: null,
    elevation,
    blocked,
    cover: EMPTY_BYTES,
  });
}
