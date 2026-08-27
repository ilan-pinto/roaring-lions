/**
 * Buildings: a box per blocked, non-ridge tile -- two visible walls and a
 * roof, darkened as the structure standing there takes damage, plus
 * hash-placed roof clutter on an undamaged one. Ported from `drawBuildingTile`
 * (`renderer.ts:1831-1861`).
 *
 * A rock ridge (`DECOR_RIDGE`) is the one blocked tile that is NOT a
 * building -- `buildScatter` already draws its rock blobs -- so this module
 * skips it exactly where Pixi does, before ever asking whether a structure
 * stands there.
 *
 * Pixi draws a wall/roof box for every blocked tile whose structure has no
 * sprite art, and a billboard sprite (plus a matching ground wash) for every
 * tile whose structure DOES have art -- `structureAtlas.has(stype.id)`
 * (`renderer.ts:1488`). Phase B2 draws no sprites at all ("No structure
 * sprites" is explicit in the plan's own "What B2 does NOT do"), so this
 * module draws the box for EVERY structure, sprited or not. That is load
 * bearing, not a simplification: `groundTone` (`tones.ts`) already paints the
 * `underBuilding` wash under every blocked non-ridge tile unconditionally,
 * on the understanding that a box is coming to sit on top of it -- skip a
 * sprited structure here and its tiles read as a slightly-dark patch of open
 * ground, a hole where the mosque should be.
 *
 * A structure spans multiple tiles as multiple independent boxes, exactly
 * like Pixi's per-tile `drawBuildingTile` call -- not one box merged across
 * the footprint. That is what lets one damaged wall panel of a nine-tile
 * building read darker than its neighbours; the merged alternative would
 * lose that per-tile legibility. It also means neighbouring tiles never draw
 * the same face: every box emits only its own east and south walls (the two
 * faces `VIEW_DIRECTION` can see -- see `ground.ts`), never north or west,
 * so two tiles of one footprint never contribute two quads to the same
 * plane over the same area -- they only ever touch along a shared edge,
 * which cannot z-fight. The one way this module COULD emit duplicate,
 * genuinely coincident geometry -- the same tile drawn twice -- is
 * structural: the outer loop below visits each tile exactly once, and the
 * structure lookup for that tile is an O(1) array read, so there is no path
 * that draws a box for one tile more than once.
 *
 * Winding for the two walls is not ported from Pixi's own vertex lists --
 * those are flat 2D canvas polygons, agnostic to winding, and copying their
 * order verbatim into 3D produced faces pointing away from the camera (this
 * module's own winding test caught it). Instead each wall reuses `ground.ts`'s
 * already hand-verified east/south face convention: a wall is that exact
 * same "one edge, two heights" quad family, just with the tile's own resting
 * height in the lower slot and the roof height in the upper one instead of a
 * neighbour's lower elevation.
 *
 * Every wall/roof fill composites over the TILE'S OWN `groundTone`, not over
 * `background` directly -- a fix-round correction. In Pixi, `drawBuildingTile`
 * draws into `spriteLayer`, which sits over `terrainG`: a sub-1 alpha fill
 * reveals whatever `drawTerrain` already painted at that tile (its
 * `underBuilding`-washed ground tone), never the page's raw clear colour.
 * `grove.ts` gets this right for exactly the same reason (`baseHex =
 * groundTone(...)`); this module's roof clutter always did too (it
 * composites over the roof's OWN just-computed colour) -- only the three
 * wall/roof surfaces underneath it were wrong, compositing against
 * `background` as if nothing had been painted first. Harmless at full
 * integrity (`wear` is 1, so the base contributes nothing), but as `wear`
 * drops the two bases diverge, and `background` (this game's near-black
 * `shadow.1`) can pull a battered wall toward the wrong hue family entirely
 * rather than merely darkening it. `groundTone` is looked up per TILE, not
 * hoisted per structure like `wear`/`roofBase` are: unlike open ground,
 * `groundTone`'s under-building branch keeps Pixi's per-tile hash jitter
 * (`tones.ts`'s own doc comment says the B2.5 fixed-alpha ruling deliberately
 * left it alone), so two tiles of one structure can legitimately quantise to
 * different ground tones on some themes -- verified by direct computation
 * against the green theme's real tones, which is NOT constant across a
 * structure's own footprint the way the arid theme's happens to be.
 */
import { WORLD_Y_PER_LIFT_PIXEL } from '../../project';
import { composite, quantise, groundTone, PALETTE_HEXES } from './tones';
import { tileHash } from '../../tile-hash';
import { CLAMP_LIMIT, clampCenterToTile } from './clamp';
import {
  DECOR_RIDGE,
  MARK_EPSILON,
  WORLD_PER_LEVEL,
  hexToUnit,
  levelAt,
  screenOffsetToWorld,
  pushPolygon,
} from './shared';
import type { MeshData, TerrainInput } from './types';
import type { TerrainTones } from '../../api';

export type { MeshData, TerrainInput };

/** `renderer.ts:1375`'s `H`: wall height (screen px) for a blocked tile with
 *  no structure behind it -- a generic wall box rather than a hole. Reached
 *  only if `ThreeRenderer` ever hands this builder a blocked, non-ridge tile
 *  that no footprint claims; every tile a real map ships is claimed (see
 *  this file's own test for the fallback path in isolation). */
const FALLBACK_HEIGHT_PX = 18;

/**
 * The three raw hex literals `drawBuildingTile` fills with
 * (`renderer.ts:1847`, `:1849`, `:1856`). `validate:ui` does not scan
 * `renderer.ts`, which is the only reason they survive as literals there --
 * this module is scanned, so they are named constants run through
 * `composite`/`quantise` like every other tone in this pipeline, never
 * written directly into a vertex colour. See `buildings.test.ts` and the
 * task report for how close each one already sits to the palette.
 */
const WALL_SOUTH_HEX = '#1E1F1A';
const WALL_EAST_HEX = '#3A3C33';
const CLUTTER_HEX = '#8E9491';

/** Both walls share `renderer.ts`'s one alpha value, 0.9 -- the south wall
 *  uses it bare, the east wall scales it by `wear` (`:1847` vs `:1849`).
 *  Porting that asymmetry rather than "fixing" it: it is what Pixi actually
 *  draws today, and inventing symmetry here would stop being a port. */
const WALL_ALPHA = 0.9;
const CLUTTER_ALPHA = 0.8;

/** Roof clutter -- a water tank or vent -- appears only on a healthy roof,
 *  hash-gated exactly like `renderer.ts:1855`. */
const CLUTTER_RND_THRESHOLD = 0.4;
const CLUTTER_INTEGRITY_THRESHOLD = 0.6;
/** `renderer.ts:1856`'s circle: radius 3px, centred at a hash offset of up
 *  to +-9px horizontally and +-4px vertically from the tile's own centre. A
 *  circle has no exact quad equivalent, so it is approximated the way
 *  `scatter.ts` approximates every mark at this scale: a 4-corner diamond
 *  (see that file's `ellipseCorners` doc comment for why that approximation
 *  is fine at fleck scale and wrong at crown scale -- this is fleck scale). */
const CLUTTER_RADIUS_PX = 3;
const CLUTTER_OFFSET_X_PX = 18;
const CLUTTER_OFFSET_Y_PX = 8;

/** One structure's worth of plain data, as `ThreeRenderer` assembles it from
 *  `Sim` -- the minimum this builder needs and nothing that would require it
 *  to import `Sim` itself: which tiles it occupies, its wall/roof height in
 *  screen px, the palette key its walls resolve through, and enough of its
 *  HP to compute `wear`. One entry per LIVING structure; a demolished
 *  structure's tiles are no longer `blocked` (`destroyStructure` unblocks
 *  its whole footprint), so they never reach this builder's tile loop at
 *  all and need no entry here. */
export interface StructureFootprint {
  /** Tile indices (`y * width + x`) this structure occupies. */
  tiles: readonly number[];
  /** Presentation-only wall/roof height, screen px -- `StructureType.heightPx`. */
  heightPx: number;
  /** Palette key for the roof/walls -- `StructureType.color`, resolved through
   *  `resolveColor` below, exactly like `drawBuildingTile` resolves it through
   *  `opts.resolveColor`. */
  colorKey: string;
  /** Current and maximum HP, whatever fixed-point scale `Sim` stores them in
   *  -- only their RATIO is read (`hp / maxHp`), which is scale-invariant,
   *  so this builder never needs to know or convert that representation. */
  hp: number;
  maxHp: number;
}

/** `renderer.ts:1856`'s circle, as a 4-corner diamond, in the same
 *  top/right/bottom/left rotational order every other flat mark in this
 *  pipeline uses (`ground.ts`'s tile top, `scatter.ts`'s `diamondCorners`). */
const CLUTTER_CORNERS: readonly (readonly [number, number])[] = [
  [0, -CLUTTER_RADIUS_PX],
  [CLUTTER_RADIUS_PX, 0],
  [0, CLUTTER_RADIUS_PX],
  [-CLUTTER_RADIUS_PX, 0],
];

export function buildBuildings(
  input: TerrainInput,
  structures: readonly StructureFootprint[],
  tones: TerrainTones,
  resolveColor: ((key: string) => string) | undefined,
  background: string,
  /**
   * Task B3.9: restrict the tile walk to exactly these tile indices (`y *
   * width + x`) instead of the full `width x height` grid -- the seam the
   * incremental rebuild needs. Omitted (every existing caller, and every
   * pre-B3.9 test) means "every tile", unchanged from before this parameter
   * existed. Given, it turns this call from O(map area) into O(tiles.length)
   * -- what lets `ThreeRenderer` recompute a SINGLE structure's own box
   * (typically a handful of tiles; the largest on any shipped map is 20) on
   * every `structureHit` without re-walking the whole map, which is what B2
   * measured at 114-179ms in the first place (`buildScatter` alone is
   * 97-145ms of it, but `buildBuildings` itself pays the same O(map area)
   * cost this parameter exists to avoid). Passing a tile NOT covered by any
   * entry in `structures` still resolves through the fallback bundle below,
   * exactly as it would in an unrestricted call -- restricting WHICH tiles
   * are visited never changes what a visited tile draws.
   */
  tiles?: readonly number[]
): MeshData {
  const { width, height } = input;
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  /** Per-tile: index into `structures`, or -1. Built once so the tile loop's
   *  structure lookup is O(1) -- and so that if two footprints somehow
   *  claimed the same tile, the last write wins rather than the tile being
   *  drawn twice; either way, a tile is drawn at most once. */
  const footprintOf = new Int32Array(width * height).fill(-1);
  for (let i = 0; i < structures.length; i++) {
    for (const ti of structures[i].tiles) footprintOf[ti] = i;
  }

  const pushQuad = (
    p0: [number, number, number],
    p1: [number, number, number],
    p2: [number, number, number],
    p3: [number, number, number],
    color: [number, number, number],
    flip: boolean
  ): void => pushPolygon(positions, colors, indices, [p0, p1, p2, p3], color, flip);

  const pushClutter = (x: number, y: number, roofY: number, rnd: number, colorHex: string): void => {
    const color = hexToUnit(colorHex);
    const offsetPxX = (rnd - 0.5) * CLUTTER_OFFSET_X_PX;
    const offsetPxY = (rnd - 0.5) * CLUTTER_OFFSET_Y_PX;
    const center = screenOffsetToWorld(offsetPxX, offsetPxY);
    const cornerDeltas = CLUTTER_CORNERS.map(([cdx, cdy]) => screenOffsetToWorld(cdx, cdy));
    const { centerX, centerZ, scale } = clampCenterToTile(center.dx, center.dy, cornerDeltas, CLAMP_LIMIT);
    const originX = x + 0.5;
    const originZ = y + 0.5;
    const world = cornerDeltas.map(
      (d) =>
        [originX + centerX + d.dx * scale, roofY + MARK_EPSILON, originZ + centerZ + d.dy * scale] as [
          number,
          number,
          number,
        ]
    );
    pushQuad(world[0], world[1], world[2], world[3], color, false);
  };

  /**
   * One box at tile `(x, y)`: `topY` is the tile's own resting height
   * (elevation-lifted, same value `ground.ts` gives that tile's top), `roofY`
   * is `topY` plus the wall height converted to world units (schema-legal
   * `heightPx: 0` collapses `roofY` onto `topY` -- a degenerate, zero-area
   * box rather than a crash; no shipped structure is authored that way
   * today). `wallSouthHex`/`wallEastHex`/`roofHex`/`clutterHex` are already
   * final and quantised -- computed by the caller from THIS tile's own
   * `groundTone`, which is why they are passed in per call rather than
   * hoisted alongside `heightPx`/`integrity`.
   */
  const pushBox = (
    x: number,
    y: number,
    topY: number,
    roofY: number,
    wallSouthHex: string,
    wallEastHex: string,
    roofHex: string,
    clutterHex: string,
    integrity: number
  ): void => {
    const wallSouthColor = hexToUnit(wallSouthHex);
    const wallEastColor = hexToUnit(wallEastHex);
    const roofColor = hexToUnit(roofHex);

    // South wall (renderer.ts:1847): the tile edge (x, y+1)-(x+1, y+1) --
    // `ground.ts`'s own south face, tile-height in the lower slot and roof
    // height in the upper one. flip: false, same as that face.
    pushQuad(
      [x, roofY, y + 1],
      [x + 1, roofY, y + 1],
      [x + 1, topY, y + 1],
      [x, topY, y + 1],
      wallSouthColor,
      false
    );
    // East wall (renderer.ts:1849): the tile edge (x+1, y)-(x+1, y+1) --
    // `ground.ts`'s own east face. flip: true, same as that face.
    pushQuad(
      [x + 1, roofY, y],
      [x + 1, roofY, y + 1],
      [x + 1, topY, y + 1],
      [x + 1, topY, y],
      wallEastColor,
      true
    );
    // Roof: a flat top at roofY, the same corners and winding as a
    // `ground.ts` tile top (+Y normal, camera-visible from above).
    pushQuad(
      [x, roofY, y],
      [x + 1, roofY, y],
      [x + 1, roofY, y + 1],
      [x, roofY, y + 1],
      roofColor,
      false
    );

    const rnd = tileHash(x, y);
    if (rnd > CLUTTER_RND_THRESHOLD && integrity > CLUTTER_INTEGRITY_THRESHOLD) {
      pushClutter(x, y, roofY, rnd, clutterHex);
    }
  };

  // The fallback bundle: a blocked, non-ridge tile no footprint claims draws
  // a generic wall box at FALLBACK_HEIGHT_PX, roof tone `tones.blocked`,
  // full integrity -- `drawBuildingTile`'s own default before it learns
  // whether `structureAt` found anything (renderer.ts:1831-1839). Only the
  // structure-level facts (never the tile's own groundTone) are hoistable,
  // so this bundle stops short of a final colour -- see the module doc
  // comment on why `groundTone` cannot be hoisted the same way.
  const fallbackIntegrity = 1;
  const fallbackBundle = {
    heightPx: FALLBACK_HEIGHT_PX,
    integrity: fallbackIntegrity,
    wear: 0.45 + 0.55 * fallbackIntegrity,
    roofBase: tones.blocked,
  };

  // Per-structure bundles: heightPx/integrity/wear/roofBase depend only on
  // that structure's own type and hp/maxHp, never on which of its tiles is
  // being drawn, so hoisting THESE FOUR (and only these four -- not the
  // final colours) out of the tile loop is still correct.
  const bundles = structures.map((s) => {
    const integrity = s.maxHp > 0 ? Math.max(0, s.hp / s.maxHp) : 1;
    const wear = 0.45 + 0.55 * integrity;
    const roofBase = resolveColor ? resolveColor(s.colorKey) : tones.blocked;
    return { heightPx: s.heightPx, integrity, wear, roofBase };
  });

  /**
   * One tile's worth of the walk below -- `x`/`y`/`ti` for a single tile,
   * body unchanged from the pre-B3.9 loop except `continue` becomes `return`
   * (the two mean the same thing here: skip this tile, visit the next).
   * Factored out so it can be driven by either the full grid or a caller-
   * supplied `tiles` list without duplicating the body -- see `tiles`'s own
   * doc comment on the parameter above.
   *
   * Bounds-checks `ti` before ever indexing `input.blocked` with it. The
   * unrestricted grid loop below always hands in a `ti` it derived from `x`/
   * `y` within `[0, width) x [0, height)`, so it can never be out of range --
   * but the caller-supplied `tiles` path (Task B3.9) takes an external index
   * list on faith, and an out-of-range `ti` there makes `input.blocked[ti]`
   * `undefined`, which is `!== 0`: without this guard the tile falls through
   * to a real box draw, at whatever `x`/`y` `ti % width`/`ti / width` happen
   * to decode to, on data every other read in this function (`levelAt`,
   * `groundTone`, `footprintOf`) would also be reading out of bounds for --
   * a garbage box, not a skipped tile. Internal callers only pass tiles from
   * `structures[i].tiles`, which `walkStructureFootprints` derives the same
   * bounds-safe way the grid loop does, so this is defence at the boundary
   * this function's own signature promises, not a reachable path today.
   */
  const visitTile = (x: number, y: number, ti: number): void => {
    if (ti < 0 || ti >= width * height) return;
    if (input.blocked[ti] === 0) return;
    const decorHere = input.decor ? input.decor[ti] : 0;
    if (decorHere === DECOR_RIDGE) return;

    const topY = levelAt(input, x, y) * WORLD_PER_LEVEL;
    const fi = footprintOf[ti];
    const b = fi >= 0 ? bundles[fi] : fallbackBundle;

    // The tile's own ground tone -- what `drawTerrain` already painted at
    // this tile before `drawBuildingTile`'s box goes over it in Pixi's
    // `spriteLayer`. The composite base for every fill below, exactly as
    // `grove.ts` uses it for its own tree/shadow tones.
    const gt = groundTone(input, tones, ti, PALETTE_HEXES, background);
    const wallSouthHex = quantise(composite(gt, WALL_SOUTH_HEX, WALL_ALPHA), PALETTE_HEXES);
    const wallEastHex = quantise(composite(gt, WALL_EAST_HEX, WALL_ALPHA * b.wear), PALETTE_HEXES);
    const roofHex = quantise(composite(gt, b.roofBase, b.wear), PALETTE_HEXES);
    const clutterHex = quantise(composite(roofHex, CLUTTER_HEX, CLUTTER_ALPHA), PALETTE_HEXES);

    const roofY = topY + b.heightPx * WORLD_Y_PER_LIFT_PIXEL;
    pushBox(x, y, topY, roofY, wallSouthHex, wallEastHex, roofHex, clutterHex, b.integrity);
  };

  if (tiles) {
    for (const ti of tiles) visitTile(ti % width, Math.floor(ti / width), ti);
  } else {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) visitTile(x, y, y * width + x);
    }
  }

  return {
    positions: Float32Array.from(positions),
    colors: Float32Array.from(colors),
    indices: Uint32Array.from(indices),
  };
}
