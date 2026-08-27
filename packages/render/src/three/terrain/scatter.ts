/**
 * Ground grain: limestone flecks, sward blades, bushes/tussocks, cover
 * rubble, knolls, ridges, road ruts and slope-face dressing. Everything
 * `buildGround` deliberately leaves flat and untextured.
 *
 * Pixi draws every mark in screen pixels, relative to a tile's own centre --
 * it has no other coordinate system to draw in. Three.js needs those marks on
 * the ground plane, in world units. `screenOffsetToWorld` is the bridge: the
 * exact inverse of `isoX`/`isoY`, so every Pixi offset (`(a - 0.5) * 52`, a
 * blob radius, a rut's pixel depth -- all of it) can be fed straight through
 * and land in the same relative spot, at whatever elevation the tile itself
 * stands at.
 *
 * Every mark is a small flat quad on the tile's own ground plane (or, for
 * slope-face dressing, on the face's own vertical plane) -- never an
 * extruded shape. That matches Pixi's own choice for the ridge and knoll
 * scatter ("Rock, not height... flat within its own tile") and is simply
 * true of every other mark here too: Pixi never draws anything in this
 * module taller than a stroke on a 2D canvas, so there is no "true height"
 * to port. A sward blade's screen-space vertical stroke becomes a small quad
 * elongated in the direction `screenOffsetToWorld` sends "up the screen" --
 * it reads as a blade from the isometric view without literal 3D extrusion.
 */
import { WORLD_PER_LEVEL } from './ground';
import { TILE_W, TILE_H, ELEV_STEP, isoX, isoY } from '../../project';
import { composite, quantise, groundTone, PALETTE_HEXES } from './tones';
import { tileHash } from '../../tile-hash';
import type { MeshData, TerrainInput } from './types';
import type { TerrainTones } from '../../api';

export type { MeshData, TerrainInput };

/**
 * DECOR values this module reads. Mirrors `TERRAIN_DECOR` in renderer.ts and
 * the redeclaration in `tones.ts` -- see that file's doc comment for why this
 * is a redeclaration rather than an import (renderer.ts pulls in pixi.js at
 * module scope; `@lions/render` must not depend on `@lions/data`).
 */
const DECOR_ROAD = 1;
const DECOR_GROVE = 2;
const DECOR_KNOLL = 3;
const DECOR_RIDGE = 4;

/**
 * Alphas `renderer.ts`'s two visible side faces composite at (`:1421`,
 * `:1432`). Private to `ground.ts`, so redeclared here rather than imported --
 * needed to reproduce the exact base tone slope-face dressing sits on.
 */
const FACE_ALPHA_EAST = 0.7;
const FACE_ALPHA_SOUTH = 0.85;

/**
 * Marks sit this far above their own tile's top, in world units, so they do
 * not z-fight the ground quad directly beneath them. `WORLD_PER_LEVEL` (one
 * elevation step) is about 0.255 world units, so 0.01 is under 4% of the
 * *smallest* terrace step -- comfortably below what reads as "floating" --
 * while the camera's fixed 30-degree elevation angle means a pure-Y offset
 * contributes only `sin(30deg) = 0.5` of itself to view-space depth; against
 * the orthographic depth range configured in `camera.ts` (near 0.1, far
 * 20,000, a 24-bit buffer) one buffer step is on the order of 0.0012 view
 * units, so 0.01 world units (0.005 of depth) clears it with room to spare.
 */
const MARK_EPSILON = 0.01;

/**
 * A second, taller epsilon for a highlight mark that is meant to sit in
 * front of a base mark it partially overlaps (the ridge/knoll blob-plus-
 * highlight pairs, and the stone fleck's shading pass). Camera pitch is
 * fixed and its view direction has a strictly positive Y component
 * (`VIEW_DIRECTION.y = sin(30deg) > 0`, `camera.ts`), so a higher world Y is
 * always closer to the camera along the view axis and always wins the depth
 * test -- independent of pan or zoom. Still tiny in absolute terms.
 */
export const HIGHLIGHT_EPSILON = 0.02;

/** Slope-face dressing is pushed this far out along the face's own outward
 *  normal (+X for an east face, +Z for a south face -- the same signs
 *  `VIEW_DIRECTION` carries on both axes) so it does not z-fight the face
 *  quad it sits on. Same magnitude as `MARK_EPSILON`, same reasoning. */
const FACE_MARK_EPSILON = 0.01;

/**
 * Half-thickness, in world Y, of a strata line or the lit top edge -- thin
 * enough to read as a hairline against a ~0.255-unit elevation step.
 *
 * Exported (like `HIGHLIGHT_EPSILON`) for `scatter.test.ts`'s "puts marks on
 * the tile top when raised" test, which specifically needs to tell a grain
 * highlight's height apart from a face band's: `drawSlopeFace` computes a
 * raised tile's face height from `levelHere` directly, independent of
 * whatever a broken grain-height calculation might do, so on any map with
 * elevation *some* tile's face top edge reaches the correct height
 * regardless -- a plain "does the mesh reach this height at all" check
 * would pass even with grain itself silently buried at elevation 0. Only a
 * height strictly above `topY + FACE_BAND_HALF_Y` can be grain's doing.
 */
export const FACE_BAND_HALF_Y = 0.01;

/** Half the unit tile, minus a small margin. Grain-mark corners are clamped
 *  to this from their own tile centre -- see `pushMark`'s doc comment for
 *  why a raw port of Pixi's pixel bounds cannot skip this. */
const CLAMP_MARGIN = 0.02;
const CLAMP_LIMIT = 0.5 - CLAMP_MARGIN;

/** Scree's base blob sits at the foot of a slope, inset this far off the
 *  exact shared edge and onto the lower tile -- reads as debris resting
 *  against the wall rather than a mark straddling the seam between two
 *  different heights. */
const SCREE_INSET = 0.05;
/**
 * The highlight blob (offset (-r*0.4, -r*0.4) from the base, per
 * `renderer.ts:1354`) needs a bigger inset than the base: that offset,
 * combined with the highlight shape's own corner furthest back toward the
 * face, reaches up to 0.0984 world units back past the base's own anchor at
 * scree's largest radius (checked numerically across the full r range,
 * [2, 3.5]) -- enough to land the highlight behind the face plane, where it
 * is occluded, if it used `SCREE_INSET` too. `SCREE_INSET` alone (0.05) is
 * what let two highlight centres land at x = 0.9954 / 0.9976 on a Task
 * B2.5 review -- behind the plane at x = 1. This clears that worst case
 * with margin.
 */
const SCREE_HIGHLIGHT_INSET = 0.11;
/** The hash-driven position along a slope's shared edge is clamped to this
 *  range before use, so a scree blob's own small radius cannot push it past
 *  the edge tile's far boundary even at the hash's extremes. */
const SCREE_A_MIN = 0.1;
const SCREE_A_MAX = 0.9;

/**
 * World-space (x, y) offset from a tile centre that projects, via
 * `isoX`/`isoY`, to the given screen-pixel offset from that same tile's
 * screen centre. The exact inverse of the dimetric projection:
 *
 *   isoX(ddx, ddy) = (ddx - ddy) * TILE_W / 2
 *   isoY(ddx, ddy) = (ddx + ddy) * TILE_H / 2
 *
 * Solving that 2x2 system for (ddx, ddy) given (dx, dy) gives the two lines
 * below. This is what lets every Pixi scatter offset -- tuned by eye against
 * the screen-space tile diamond -- be fed straight through and land in the
 * same relative spot in three.js, at whatever height the tile itself stands
 * at.
 */
export function screenOffsetToWorld(dx: number, dy: number): { dx: number; dy: number } {
  return {
    dx: dx / TILE_W + dy / TILE_H,
    dy: dy / TILE_H - dx / TILE_W,
  };
}

function hexToUnit(hex: string): [number, number, number] {
  const h = hex.charAt(0) === '#' ? hex.slice(1) : hex;
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ];
}

/** Mirrors `ground.ts`'s private `levelAt`: elevation level (0-9) at
 *  `(x, y)`, or 0 off the map. Not exported there, so redeclared here --
 *  five lines, not worth widening that module's surface for. */
function levelAt(input: TerrainInput, x: number, y: number): number {
  if (x < 0 || x >= input.width || y < 0 || y >= input.height) return 0;
  if (!input.elevation) return 0;
  return input.elevation[y * input.width + x];
}

/**
 * True if any of the 8 tiles surrounding `(x, y)` sits at a different
 * elevation level than `(x, y)` itself -- the one condition an unclamped
 * mark's containment actually needs to guard against (a mark floating over
 * a neighbour at the wrong height). Off-map counts as level 0, same as
 * `levelAt` everywhere else, so a raised rim tile correctly reads as having
 * an edge even though it has no on-map neighbour on that side.
 *
 * `pushMark`'s `clamp` argument reads this per tile rather than being a
 * blanket `true`: on a flat map (`input.elevation` absent, or present but
 * uniform -- every shipped map except Tel Marum) this is `false`
 * everywhere, so every mark keeps its raw, unclamped `screenOffsetToWorld`
 * position -- exactly Pixi's own placement, overhang and all, with zero
 * distortion. That overhang is real and matches Pixi on purpose: Pixi's own
 * road-rut ends run past their own tile's screen-space diamond
 * (`renderer.ts:1526-1530`, checked against the source directly -- at
 * `rut`'s 26px horizontal reach the diamond's own half-height is down to
 * ~3px), and it is invisible there because a flat run of road tiles has
 * nothing to float over. Clamping unconditionally, the way an earlier
 * version of this function did, punished every mark on every tile for a
 * risk that only exists near an actual drop -- measured at 30-75% of
 * marks materially repositioned even on ordinary open ground, and total
 * (100%) for road ruts specifically, which collapsed their two lines to
 * within 0.1 tile of each other against Pixi's authored 0.31-0.44.
 */
function hasElevationEdge(input: TerrainInput, x: number, y: number): boolean {
  if (!input.elevation) return false;
  const levelHere = levelAt(input, x, y);
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      if (levelAt(input, x + dx, y + dy) !== levelHere) return true;
    }
  }
  return false;
}

/** A small quad's four corners, as screen-pixel offsets from its own centre,
 *  in the same rotational order `ground.ts`'s tile-top quad uses (its own
 *  four *world* corners (x,y)->(x+1,y)->(x+1,y+1)->(x,y+1) project, via
 *  isoX/isoY, to exactly this order: top, right, bottom, left). Reusing that
 *  order -- rather than re-deriving winding by hand -- is what lets every
 *  mark share the tile top's proven-correct `flip: false`. */
function diamondCorners(rx: number, ry: number): readonly (readonly [number, number])[] {
  return [
    [0, -ry],
    [rx, 0],
    [0, ry],
    [-rx, 0],
  ];
}

/** A rectangle's four corners in the same top/right/bottom/left-derived
 *  rotational order as `diamondCorners` -- top-left, top-right, bottom-right,
 *  bottom-left in screen space (y-down), which traces the same clockwise
 *  sense. `topDy`/`botDy` let a mark be asymmetric about its own anchor (the
 *  sward blade, whose "blade" runs from the ground up rather than being
 *  centred on it). */
function rectCorners(
  halfW: number,
  topDy: number,
  botDy: number
): readonly (readonly [number, number])[] {
  return [
    [-halfW, topDy],
    [halfW, topDy],
    [halfW, botDy],
    [-halfW, botDy],
  ];
}

export function buildScatter(input: TerrainInput, tones: TerrainTones, background: string): MeshData {
  const { width, height } = input;
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  // Computed once, outside the tile loop: both alphas are fixed, and the base
  // they composite against (`background`) does not vary per tile. Every
  // slope face on the map shares these two colours, same as `ground.ts`'s
  // own `faceEastHex`/`faceSouthHex` -- worth saying so a reviewer sampling a
  // single face pixel does not mistake a shared colour for a missing one.
  const faceEastHex = quantise(composite(background, tones.rock, FACE_ALPHA_EAST), PALETTE_HEXES);
  const faceSouthHex = quantise(composite(background, tones.rock, FACE_ALPHA_SOUTH), PALETTE_HEXES);

  const pushQuad = (
    p0: [number, number, number],
    p1: [number, number, number],
    p2: [number, number, number],
    p3: [number, number, number],
    color: [number, number, number],
    flip: boolean
  ): void => {
    const base = positions.length / 3;
    for (const p of [p0, p1, p2, p3]) positions.push(p[0], p[1], p[2]);
    for (let i = 0; i < 4; i++) colors.push(color[0], color[1], color[2]);
    if (flip) {
      indices.push(base + 0, base + 1, base + 2, base + 0, base + 2, base + 3);
    } else {
      indices.push(base + 0, base + 2, base + 1, base + 0, base + 3, base + 2);
    }
  };

  /**
   * Pushes one flat ground-plane mark: a centre at screen-pixel offset
   * `(offsetPxX, offsetPxY)` from the tile centre `(originX, originZ)`, with
   * `corners` (screen-pixel offsets from that centre) tracing its shape.
   * Both convert through `screenOffsetToWorld`; when `clamp` is set, the
   * whole mark is then kept inside `CLAMP_LIMIT` tiles of `(originX,
   * originZ)`.
   *
   * `clamp` is `needsContainment` at every real call site -- see
   * `hasElevationEdge`'s doc comment for why that is a per-tile condition
   * (an actual elevation drop nearby) rather than a blanket `true`. This
   * function does not decide WHETHER to contain a mark, only HOW, once
   * asked to: Pixi bounds each mark's own pixel offset against the
   * screen-space tile diamond by eye, one axis at a time -- but the two
   * axes are independent hashes, and the diamond is not a rectangle: a
   * stone fleck's worst case, both hashes at their extreme (offset
   * (26px, 13px), within the diamond on each axis alone), converts via
   * `screenOffsetToWorld` to a world offset of (0.8125, 0) -- 62% past the
   * tile's own edge. Left unclamped near an elevation drop, that mark would
   * sit on the *next* tile's ground, at this tile's height: exactly the
   * "floats" failure this task's brief warns about.
   *
   * Reposition first, shrink only as a fallback. The centre is clamped not
   * to `CLAMP_LIMIT` itself but to `CLAMP_LIMIT - <this mark's own
   * half-extent>`, which is exactly enough room for its full, unscaled
   * shape to still fit once the centre lands at that tighter bound -- so
   * `scale` stays 1 for every mark this module builds, INCLUDING a road
   * rut's rect, whose ~0.43-tile half-extent leaves only ~0.05 of headroom
   * under `CLAMP_LIMIT` (0.48): tight enough that an earlier version of
   * this design, which clamped every mark unconditionally rather than only
   * `needsContainment` ones, pinned every rut's centre at that same ~0.05
   * regardless of its intended ±5px/±7px offset -- collapsing two lines
   * meant to read as 0.31-0.44 tiles apart to within 0.1 of each other,
   * every time, on every road tile, not just at hash extremes. Reposition
   * (not shrink) is still the right shape of fix for when `clamp` IS
   * `true`; making that condition mean "an elevation edge is actually
   * nearby" is what stops it from being punitive everywhere else. Only a
   * shape whose own half-extent exceeded `CLAMP_LIMIT` outright -- nothing
   * here does -- would still need the shrink fallback below; the maths
   * stays correct if one ever does.
   *
   * Scaling uniformly -- one `scale` factor applied to both axes of every
   * corner, rather than clamping each corner independently -- matters
   * beyond cosmetics: an earlier version clamped per corner, and a mark
   * whose centre sat right at the boundary while its corners straddled it
   * left some corners clamped and others not, producing a near-degenerate
   * quad. Float32 rounding on that near-collinear triangle flipped its
   * winding sign under this task's own winding test. A uniform scale is an
   * orientation-preserving similarity transform -- it can only shrink a
   * mark toward its centre, cleanly to a single point in the extreme case
   * (a true, unambiguous zero-area degenerate, not a numerically-ambiguous
   * sliver) -- so winding can never flip. `clamp: false` unconditionally is
   * for scree, whose anchor is not a tile centre and whose bound the caller
   * has already handled by hand (its own inset plus a clamped edge
   * parameter) -- it sits right at an elevation drop by construction (drawn
   * only when one exists) but needs a different bound than this function's.
   */
  const pushMark = (
    originX: number,
    originZ: number,
    topY: number,
    epsilon: number,
    offsetPxX: number,
    offsetPxY: number,
    corners: readonly (readonly [number, number])[],
    colorHex: string,
    clamp: boolean
  ): void => {
    const color = hexToUnit(colorHex);
    const center = screenOffsetToWorld(offsetPxX, offsetPxY);
    const cornerDeltas = corners.map(([cdx, cdy]) => screenOffsetToWorld(cdx, cdy));

    let centerX = center.dx;
    let centerZ = center.dy;
    let scale = 1;
    if (clamp) {
      let maxAbsDX = 0;
      let maxAbsDZ = 0;
      for (const d of cornerDeltas) {
        maxAbsDX = Math.max(maxAbsDX, Math.abs(d.dx));
        maxAbsDZ = Math.max(maxAbsDZ, Math.abs(d.dy));
      }
      const limitX = Math.max(0, CLAMP_LIMIT - maxAbsDX);
      const limitZ = Math.max(0, CLAMP_LIMIT - maxAbsDZ);
      centerX = Math.max(-limitX, Math.min(limitX, centerX));
      centerZ = Math.max(-limitZ, Math.min(limitZ, centerZ));
      const roomX = CLAMP_LIMIT - Math.abs(centerX);
      const roomZ = CLAMP_LIMIT - Math.abs(centerZ);
      if (maxAbsDX > 0) scale = Math.min(scale, roomX / maxAbsDX);
      if (maxAbsDZ > 0) scale = Math.min(scale, roomZ / maxAbsDZ);
    }

    const world = cornerDeltas.map(
      (d) =>
        [originX + centerX + d.dx * scale, topY + epsilon, originZ + centerZ + d.dy * scale] as [
          number,
          number,
          number,
        ]
    );
    pushQuad(world[0], world[1], world[2], world[3], color, false);
  };

  /**
   * Pushes one strata/lit-top-edge band on a slope face -- pure world-space,
   * no `screenOffsetToWorld` involved. Unlike a ground mark, a face band's
   * position is not an offset from a tile centre: it is a height along an
   * edge `ground.ts`'s own face quad already establishes exactly (the shared
   * boundary between a tile and its lower neighbour), so it is placed
   * directly from that geometry rather than by inverting a screen pixel.
   * Vertex order and `flip` mirror `ground.ts`'s east/south face quads
   * exactly (same shape family, different Y-bounds and pushed out along the
   * face's own outward normal by `FACE_MARK_EPSILON`), which is what makes
   * their winding correct without re-deriving it.
   */
  const pushFaceBand = (faceTag: 0 | 1, x: number, y: number, bandY: number, colorHex: string): void => {
    const color = hexToUnit(colorHex);
    const top = bandY + FACE_BAND_HALF_Y;
    const bot = bandY - FACE_BAND_HALF_Y;
    if (faceTag === 0) {
      const ox = x + 1 + FACE_MARK_EPSILON;
      pushQuad([ox, top, y], [ox, top, y + 1], [ox, bot, y + 1], [ox, bot, y], color, true);
    } else {
      const oz = y + 1 + FACE_MARK_EPSILON;
      pushQuad([x, top, oz], [x + 1, top, oz], [x + 1, bot, oz], [x, bot, oz], color, false);
    }
  };

  /**
   * Slope-face dressing: strata bands, a lit top edge, and scree at the
   * foot. Ported from `drawSlopeFace` (`renderer.ts:1314-1356`). Runs for
   * every tile with a drop to a neighbour, independent of that tile's own
   * blocked/decor state -- `renderer.ts` computes it before the
   * blocked/open branch (`:1395-1436`), and so does this.
   */
  const drawSlopeFace = (
    faceTag: 0 | 1,
    x: number,
    y: number,
    levelHere: number,
    levelNeighbor: number,
    drop: number,
    faceHex: string
  ): void => {
    const topY = levelHere * WORLD_PER_LEVEL;
    const bottomY = levelNeighbor * WORLD_PER_LEVEL;

    // 1. Strata banding: one line per internal level boundary (renderer.ts:1330-1334).
    if (drop > 1) {
      const strataHex = quantise(composite(faceHex, tones.blocked, 0.35), PALETTE_HEXES);
      for (let i = 1; i < drop; i++) {
        pushFaceBand(faceTag, x, y, topY - i * WORLD_PER_LEVEL, strataHex);
      }
    }

    // 2. Lit top edge: drawn regardless of drop (renderer.ts:1336-1338).
    const edgeHex = quantise(composite(faceHex, tones.rockLit, 0.45), PALETTE_HEXES);
    pushFaceBand(faceTag, x, y, topY, edgeHex);

    // 3. Scree at the foot, drops of 2+ only (renderer.ts:1340-1355). Sits on
    // the ground at the neighbour's own height, not on the face itself, so
    // it uses `pushMark` like any other ground mark -- but anchored at the
    // shared-edge point, not a tile centre, so `clamp: false`; the edge
    // parameter is clamped by hand instead (`SCREE_A_MIN`/`MAX`).
    //
    // Composites against the NEIGHBOUR tile's own groundTone, not `faceHex`:
    // scree sits on the lower tile's ground, and the inherited rule is "the
    // tile beneath a mark", not "the face it dresses". A neighbour that is
    // off the map (a rim tile's own drop) has no groundTone to read, so it
    // falls back to `background` -- the same base groundTone itself starts
    // from, and consistent with nothing having been drawn there.
    if (drop < 2) return;
    const neighborX = faceTag === 0 ? x + 1 : x;
    const neighborY = faceTag === 0 ? y : y + 1;
    const neighborInBounds = neighborX >= 0 && neighborX < width && neighborY >= 0 && neighborY < height;
    const screeBaseHex = neighborInBounds
      ? groundTone(input, tones, neighborY * width + neighborX, PALETTE_HEXES, background)
      : background;
    const hCount = tileHash(x * 29 + faceTag * 101 + drop, y * 31 + faceTag * 103);
    const n = 3 + (Math.floor(hCount * 1000) & 1);
    for (let k = 0; k < n; k++) {
      const a = tileHash(x * 37 + faceTag * 107 + k * 7, y * 41 + faceTag * 109 + k * 5);
      const bits = tileHash(x * 43 + faceTag * 113 + k * 3, y * 47 + faceTag * 127 + k * 11);
      const r = 2 + bits * 1.5;
      const aClamped = Math.max(SCREE_A_MIN, Math.min(SCREE_A_MAX, a));
      const screeHex = quantise(composite(screeBaseHex, tones.rock, 0.9), PALETTE_HEXES);
      const hlHex = quantise(composite(screeHex, tones.rockLit, 0.5), PALETTE_HEXES);
      // Onto the LOWER tile, off the exact shared edge -- SCREE_INSET's own
      // doc comment says so; a `- SCREE_INSET` sign here previously put it
      // on the RAISED tile's side instead, inside the wedge the face quad
      // itself covers, where it was occluded and invisible.
      const originX = faceTag === 0 ? x + 1 + SCREE_INSET : x + aClamped;
      const originZ = faceTag === 0 ? y + aClamped : y + 1 + SCREE_INSET;
      pushMark(originX, originZ, bottomY, MARK_EPSILON, 0, 0, diamondCorners(r, r * 0.6), screeHex, false);
      // The highlight needs its own, larger inset -- see
      // `SCREE_HIGHLIGHT_INSET`'s doc comment for the worked-out worst case.
      const hlOriginX = faceTag === 0 ? x + 1 + SCREE_HIGHLIGHT_INSET : x + aClamped;
      const hlOriginZ = faceTag === 0 ? y + aClamped : y + 1 + SCREE_HIGHLIGHT_INSET;
      pushMark(
        hlOriginX,
        hlOriginZ,
        bottomY,
        HIGHLIGHT_EPSILON,
        -r * 0.4,
        -r * 0.4,
        diamondCorners(r * 0.5, r * 0.3),
        hlHex,
        false
      );
    }
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const ti = y * width + x;
      const levelHere = levelAt(input, x, y);
      // Containment only matters where an unclamped mark could float over
      // a differently-elevated neighbour -- see `hasElevationEdge`'s doc
      // comment. Computed once per tile, used by every mark this tile emits.
      const needsContainment = hasElevationEdge(input, x, y);
      const topY = levelHere * WORLD_PER_LEVEL;
      const cx = x + 0.5;
      const cz = y + 0.5;
      const rnd = tileHash(x, y);
      const decorHere = input.decor ? input.decor[ti] : 0;
      const coverHere = input.cover[ti];
      const blocked = input.blocked[ti] !== 0;

      // The tile's own composited-and-quantised ground tone -- what every
      // mark on this tile composites over, per the rule this task inherits
      // (`groundTone`, not the raw background, is the base a mark alpha-fills
      // against).
      const baseHex = groundTone(input, tones, ti, PALETTE_HEXES, background);

      if (blocked) {
        if (decorHere === DECOR_RIDGE) {
          // Ridge: full-tile rock diamond is already `baseHex` (groundTone's
          // blocked+ridge branch); 5 larger blobs with a highlight on top
          // (renderer.ts:1461-1477).
          for (let k = 0; k < 5; k++) {
            const a = tileHash(x * 13 + k, y * 29 + k);
            const b = tileHash(x * 7 + k, y * 19 + k);
            const px = (a - 0.5) * (TILE_W - 24);
            const py = (b - 0.5) * (TILE_H - 18);
            const r = 6 + a * 5;
            const blobHex = quantise(composite(baseHex, tones.rock, 0.95), PALETTE_HEXES);
            pushMark(cx, cz, topY, MARK_EPSILON, px, py, diamondCorners(r, r * 0.7), blobHex, needsContainment);
            const hlHex = quantise(composite(blobHex, tones.rockLit, 0.9), PALETTE_HEXES);
            pushMark(
              cx,
              cz,
              topY,
              HIGHLIGHT_EPSILON,
              px - r * 0.24,
              py - r * 0.26,
              diamondCorners(r * 0.55, r * 0.32),
              hlHex,
              needsContainment
            );
          }
        }
        // A plain blocked (building) tile gets no grain: `drawBuildingTile`/
        // the structure sprite own that ground entirely in Pixi.
      } else {
        if (decorHere === DECOR_ROAD) {
          // Road ruts: two lines, tone at 0.30 over the road's own groundTone
          // (renderer.ts:1526-1535). The parity pick uses the same screen
          // pixel Pixi's own `cx + cyG` does -- `isoX`/`isoY` at this tile's
          // own lifted height -- not a fresh hash, so the two backends pick
          // the same depth on the same tile.
          const cxPx = isoX(cx, cz);
          const cyPx = isoY(cx, cz) - levelHere * ELEV_STEP;
          const rut = (cxPx + cyPx) % 2 === 0 ? 5 : 7;
          const rutHex = quantise(composite(baseHex, tones.rut, 0.3), PALETTE_HEXES);
          const halfW = TILE_W / 2 - 6;
          pushMark(cx, cz, topY, MARK_EPSILON, 0, -rut, rectCorners(halfW, -0.75, 0.75), rutHex, needsContainment);
          pushMark(cx, cz, topY, MARK_EPSILON, 0, rut, rectCorners(halfW, -0.75, 0.75), rutHex, needsContainment);
        } else if (decorHere === DECOR_KNOLL) {
          // Knoll: 4 blobs with a highlight, smaller than a ridge's
          // (renderer.ts:1543-1553).
          for (let k = 0; k < 4; k++) {
            const a = tileHash(x * 11 + k, y * 17 + k);
            const b = tileHash(x * 23 + k, y * 5 + k);
            const px = (a - 0.5) * (TILE_W - 20);
            const py = (b - 0.5) * (TILE_H - 10);
            const r = 3 + a * 5;
            const blobHex = quantise(composite(baseHex, tones.rock, 0.95), PALETTE_HEXES);
            pushMark(cx, cz, topY, MARK_EPSILON, px, py, diamondCorners(r, r * 0.62), blobHex, needsContainment);
            const hlHex = quantise(composite(blobHex, tones.rockLit, 0.8), PALETTE_HEXES);
            pushMark(
              cx,
              cz,
              topY,
              HIGHLIGHT_EPSILON,
              px - r * 0.2,
              py - r * 0.22,
              diamondCorners(r * 0.6, r * 0.36),
              hlHex,
              needsContainment
            );
          }
        } else if (decorHere === DECOR_GROVE) {
          // Trunk shadow + canopy (renderer.ts:1558-1564) are sprited/
          // depth-sorted tree geometry, not scatter -- out of this task's
          // table and out of scope here. Left flat rather than guessed at.
        } else {
          // Open hillside grain: stone or sward, per `tones.scatter`.
          if (tones.scatter === 'sward') {
            // Sward blades (renderer.ts:1577-1596).
            const n = 8 + Math.floor(rnd * 7);
            for (let k = 0; k < n; k++) {
              const a = tileHash(x * 19 + k * 7, y * 23 + k * 5);
              const b = tileHash(x * 41 + k * 3, y * 7 + k * 11);
              const px = (a - 0.5) * (TILE_W - 12);
              const py = (b - 0.5) * (TILE_H - 6);
              const bh = 2.6 + a * 1.8;
              const bladeHex = quantise(
                composite(baseHex, b > 0.4 ? tones.bladeLit : tones.bladeShade, 0.6 + a * 0.3),
                PALETTE_HEXES
              );
              // halfW 0.5 matches Pixi's own 1px stroke width exactly
              // (renderer.ts:1594's `width: 1`) -- not a rounder-looking
              // 0.75, which would read 50% thicker than the source.
              pushMark(cx, cz, topY, MARK_EPSILON, px, py, rectCorners(0.5, -bh, 0), bladeHex, needsContainment);
            }
            if (rnd > 0.9) {
              // Bare earth patch (renderer.ts:1596-1605).
              const a = tileHash(x * 19, y * 23);
              const earthHex = quantise(composite(baseHex, tones.earth, 0.22), PALETTE_HEXES);
              pushMark(
                cx,
                cz,
                topY,
                MARK_EPSILON,
                (a - 0.5) * 22,
                0,
                diamondCorners(3 + a * 2.4, 1.6 + a * 1.2),
                earthHex,
                needsContainment
              );
            }
            if (rnd > 0.84 && coverHere === 0) {
              // Tussock: 3 fanning strokes, approximated as one mark
              // spanning their bounding box (renderer.ts:1606-1616).
              const a = tileHash(x * 31, y * 3);
              const bx = (a - 0.5) * 30;
              const by = (rnd - 0.9) * 18;
              const tussockHex = quantise(composite(baseHex, tones.low, 0.8), PALETTE_HEXES);
              // Pixi's three strokes (renderer.ts:1612-1615) run from (bx, by)
              // to (bx + k*2.6, by - 4.2 - a*1.6) for k in {-1, 0, 1}: exact
              // tip height 4.2 + a*1.6, exact base 0. Padded by 0.6 on both
              // ends -- half of the 1.2px stroke width (:1615) -- so the
              // bounding box holds the stroke's rendered pixels, not just its
              // ideal path.
              pushMark(
                cx,
                cz,
                topY,
                MARK_EPSILON,
                bx,
                by,
                rectCorners(3.2, -(4.2 + a * 1.6 + 0.6), 0.6),
                tussockHex,
                needsContainment
              );
            }
          } else {
            // Stone grain: limestone flecks + earth (renderer.ts:1616-1641).
            const n = 3 + Math.floor(rnd * 5);
            for (let k = 0; k < n; k++) {
              const a = tileHash(x * 19 + k * 7, y * 23 + k * 5);
              const b = tileHash(x * 41 + k * 3, y * 7 + k * 11);
              const px = (a - 0.5) * (TILE_W - 12);
              const py = (b - 0.5) * (TILE_H - 6);
              if (b > 0.78) {
                const earthHex = quantise(composite(baseHex, tones.earth, 0.24), PALETTE_HEXES);
                pushMark(
                  cx,
                  cz,
                  topY,
                  MARK_EPSILON,
                  px,
                  py,
                  diamondCorners(1.6 + a * 2.2, 1 + a * 1.2),
                  earthHex,
                  needsContainment
                );
              } else {
                const r = 1.2 + a * 2.6;
                const fleckHex = quantise(composite(baseHex, tones.rockLit, 0.4 + b * 0.35), PALETTE_HEXES);
                pushMark(cx, cz, topY, MARK_EPSILON, px, py, diamondCorners(r, r * 0.62), fleckHex, needsContainment);
                if (a > 0.72) {
                  const shadeHex = quantise(composite(fleckHex, tones.rock, 0.3), PALETTE_HEXES);
                  pushMark(
                    cx,
                    cz,
                    topY,
                    HIGHLIGHT_EPSILON,
                    px + r * 0.3,
                    py + r * 0.3,
                    diamondCorners(r * 0.7, r * 0.42),
                    shadeHex,
                    needsContainment
                  );
                }
              }
            }
            if (rnd > 0.84 && coverHere === 0) {
              // Dry bush (renderer.ts:1643-1650).
              const a = tileHash(x * 31, y * 3);
              const bushHex = quantise(composite(baseHex, tones.low, 0.55), PALETTE_HEXES);
              pushMark(
                cx,
                cz,
                topY,
                MARK_EPSILON,
                (a - 0.5) * 30,
                (rnd - 0.9) * 18,
                diamondCorners(3.2 + a * 1.4, 2 + a),
                bushHex,
                needsContainment
              );
            }
          }

          if (coverHere > 0) {
            // Cover rubble: `cover + 2` marks, tone `cover[min(cover,3)-1]`
            // (renderer.ts:1650-1660). Pixi's `rect` is corner-anchored, not
            // centred; centring it here is a small, deliberate approximation
            // -- rubble reads the same as scattered debris either way.
            const c = tones.cover[Math.min(coverHere, 3) - 1];
            const rubbleHex = quantise(composite(baseHex, c, 0.9), PALETTE_HEXES);
            for (let k = 0; k < coverHere + 2; k++) {
              const a = tileHash(x * 7 + k, y * 13 + k);
              const b = tileHash(x * 31 + k, y * 3 + k);
              const px = (a - 0.5) * (TILE_W - 18);
              const py = (b - 0.5) * (TILE_H - 8);
              const halfW = (4 + a * 4) / 2;
              pushMark(cx, cz, topY, MARK_EPSILON, px, py, rectCorners(halfW, -1.25, 1.25), rubbleHex, needsContainment);
            }
          }
        }
      }

      // Slope-face dressing runs for every tile with a drop, independent of
      // the blocked/decor branch above -- see `drawSlopeFace`'s doc comment.
      const levelEast = levelAt(input, x + 1, y);
      const dropEast = levelHere - levelEast;
      if (dropEast > 0) {
        drawSlopeFace(0, x, y, levelHere, levelEast, dropEast, faceEastHex);
      }
      const levelSouth = levelAt(input, x, y + 1);
      const dropSouth = levelHere - levelSouth;
      if (dropSouth > 0) {
        drawSlopeFace(1, x, y, levelHere, levelSouth, dropSouth, faceSouthHex);
      }
    }
  }

  return {
    positions: Float32Array.from(positions),
    colors: Float32Array.from(colors),
    indices: Uint32Array.from(indices),
  };
}
