/**
 * Where scattered decor goes, as plain data.
 *
 * Headless on purpose -- no three.js -- so the placement rule is unit-tested
 * directly rather than inferred from a render, exactly like `buildScatter`
 * and `buildGroves` already are.
 *
 * Derived from what a builder can actually read. NOTE: the design doc's table
 * is keyed by map SYMBOL; `TerrainInput` carries no symbols, only the decoded
 * `decor`/`cover`/`blocked`/`elevation` layers, so the rule is keyed by those.
 *
 * Randomness is `tileHash(x, y)`, the same deterministic hash the Pixi
 * backend's ground grain uses -- two hashes that merely both looked random
 * would scatter differently per backend and make every comparison noise.
 * Several independent streams come from offsetting the coordinates, which is
 * cheaper than threading a seed and just as stable.
 */
import { tileHash } from '../../tile-hash';
import {
  DECOR_DITCH,
  DECOR_GROVE,
  DECOR_KNOLL,
  DECOR_RIDGE,
  DECOR_ROAD,
  WORLD_PER_LEVEL,
} from './shared';
import type { TerrainInput } from './types';

export type DecorFamily =
  | 'grass'
  | 'sand'
  | 'bush'
  | 'tree'
  | 'rock'
  | 'slab'
  | 'boulder'
  | 'ditch';

export interface DecorPlacement {
  readonly family: DecorFamily;
  readonly variant: number;
  readonly x: number;
  readonly z: number;
  readonly y: number;
  readonly yawTurns: number;
  readonly scale: number;
}

export const VARIANTS_PER_FAMILY = 3;

/** How often a qualifying tile actually gets an object. Cover tiles scale
 *  with their level, so a cover-3 thicket reads denser than a cover-1 verge.
 *  `boulder` is 1.0 -- deliberately unconditional, not merely "denser than
 *  rock's 0.75": `b` is a mechanic (a wall to wheels and tracks), not an
 *  aesthetic scatter, and a roll that skipped even one boulder tile would
 *  draw a gap a vehicle could see straight through. */
const DENSITY: Record<DecorFamily, number> = {
  grass: 0.34,
  sand: 0.18,
  bush: 0.3,
  tree: 1.0,
  rock: 0.75,
  slab: 0.6,
  boulder: 1.0,
  // 1.0 for the same reason `boulder` is, and harder: a `d` tile is a wall to
  // anything wheeled or tracked, and a roll that skipped one would draw a
  // visible hole in a continuous earthwork -- a gap the player can see and
  // reasonably read as a way through, on ground `blockedVehicle` says is
  // impassable. That is a gameplay lie, not a cosmetic one.
  ditch: 1.0,
};

/**
 * How far a ditch segment's apron is lifted above the terrain it replaces,
 * in world units.
 *
 * The GLB grounds its APRON's top surface at exactly Z=0
 * (`tools/terrain/export_meshy_ditch.py`, "GROUNDING"), which would make it
 * exactly coplanar with the terrain plane and z-fight across the whole
 * apron -- a fifth of the segment's width, speckling. This is the epsilon
 * that separates them.
 *
 * Deliberately here rather than baked into the GLB: it is a renderer fact,
 * retunable without a re-export, and a reader of the export script should not
 * have to know about the depth buffer.
 *
 * 0.004 is ~1.6% of `WORLD_PER_LEVEL`, so it cannot read as a step at any
 * zoom, and against this camera's ortho depth range it is several hundred
 * depth-buffer steps -- far above the noise floor.
 */
export const DITCH_LIFT = 0.004;

/** Ditch segments are baked to exactly one tile of length and get no random
 *  scale at all. Every other family jitters 0.8-1.2 to break up repetition;
 *  a ditch that did would leave gaps and overlaps along its own run. */
const DITCH_SCALE = 1;

/** The one ditch GLB. `VARIANTS_PER_FAMILY` still governs every other family;
 *  a ditch has a single source, and rolling a variant it does not have would
 *  drop two thirds of its tiles through `buildDecorMesh`'s missing-key path
 *  and punch exactly the holes `DENSITY.ditch = 1.0` exists to prevent. */
const DITCH_VARIANT = 0;

/** Which family this tile offers, or null for "nothing grows here".
 *  `boulder` is checked first and unconditionally: `map.ts`'s own legend
 *  ties the `b` symbol to blocked=0/decor=none/cover=0 always, which is
 *  exactly the shape every branch below already reads as "roll grass or
 *  sand" -- so a boulder tile that fell through to those branches would draw
 *  as bare, walkable ground with a tuft on it, the T1-C bug this exists to
 *  fix. */
function familyFor(decor: number, cover: number, roll: number, boulder: boolean): DecorFamily | null {
  // BEFORE the boulder branch, and that order is load-bearing. A `d` tile
  // sets `boulder` too -- the two symbols share one vehicle-only mask by
  // design -- so a ditch that fell through to the branch below would draw a
  // field of rocks in its trench and no ditch anywhere.
  if (decor === DECOR_DITCH) return 'ditch';
  if (boulder) return 'boulder';
  if (decor === DECOR_ROAD) return null;
  if (decor === DECOR_GROVE) return 'tree';
  if (decor === DECOR_KNOLL) return 'rock';
  if (decor === DECOR_RIDGE) return 'slab';
  if (cover > 0) return 'bush';
  return roll < 0.6 ? 'grass' : 'sand';
}

/**
 * Whether (x, y) is a ditch tile. Out of bounds is not.
 *
 * Reads the DECOR layer, not `boulder`: `b` sets the same mask bit, so asking
 * `boulder` here would make a boulder field next door bend a ditch's run.
 */
function isDitch(decor: Uint8Array | null, width: number, height: number, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= width || y >= height) return false;
  return decor !== null && decor[y * width + x] === DECOR_DITCH;
}

/**
 * The yaw turns for a ditch segment's run axis, one entry per segment this
 * tile draws.
 *
 * The asset is a STRAIGHT PRISMATIC SEGMENT baked to exactly one tile of
 * length: laid end to end it is continuous (measured seam mismatch 0.0019 of
 * a 0.236 model height, and decimation does not worsen it), and it cannot
 * express a bend. So a run of arbitrary shape has three cases and this
 * function is where all three are decided:
 *
 *  * STRAIGHT (neighbours on one axis only) -- one segment on that axis.
 *    Because the segment is exactly a tile long and centred, consecutive
 *    tiles abut with no gap and no overlap.
 *
 *  * JUNCTION (neighbours on BOTH axes -- a corner, a T, a crossroads) --
 *    TWO segments, one per axis. This is the honest trade and it is made
 *    deliberately: the asset has no bend, so a corner is either a hole or a
 *    crossing, and a hole is the failure that matters. One segment alone
 *    would leave the other arm's last tile ending 0.29 tiles short of the
 *    trench it is supposed to join -- a visible break in an obstacle the
 *    player is reading to decide whether armour can pass. Two segments cross
 *    at the tile centre instead: no gap ever, at the cost of a visible
 *    X where two trenches meet rather than a smooth bend. **Author ditches
 *    as straight runs**; a corner will look like a crossing, because it is
 *    one. The two segments interpenetrate rather than sharing surfaces, so
 *    this is a modelling artefact, not z-fighting.
 *
 *  * ISOLATED (no ditch neighbour at all) -- one segment, along X. Arbitrary
 *    but fixed, never random: a lone `d` tile is a one-tile obstacle and
 *    there is no run for it to agree with, so the only thing that matters is
 *    that it is deterministic. Rolling `tileHash` here would make a run's
 *    first authored tile flip axis the moment a second tile was authored
 *    beside it.
 */
function ditchYawTurns(
  decor: Uint8Array | null,
  width: number,
  height: number,
  x: number,
  y: number
): readonly number[] {
  const horizontal =
    isDitch(decor, width, height, x - 1, y) || isDitch(decor, width, height, x + 1, y);
  const vertical =
    isDitch(decor, width, height, x, y - 1) || isDitch(decor, width, height, x, y + 1);
  if (horizontal && vertical) return DITCH_YAW_BOTH;
  if (vertical) return DITCH_YAW_VERTICAL;
  return DITCH_YAW_HORIZONTAL;
}

/** The GLB's long axis is +X, so 0 turns runs the trench along the map's x
 *  axis and a quarter turn runs it along y. Module constants rather than
 *  fresh arrays per tile: `decorPlacements` runs over every tile of every
 *  map on every terrain rebuild. */
const DITCH_YAW_HORIZONTAL: readonly number[] = [0];
const DITCH_YAW_VERTICAL: readonly number[] = [0.25];
const DITCH_YAW_BOTH: readonly number[] = [0, 0.25];

export function decorPlacements(input: TerrainInput): DecorPlacement[] {
  const { width, height, blocked, cover, decor, elevation, boulder } = input;
  const out: DecorPlacement[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const t = y * width + x;
      const d = decor ? decor[t] : 0;
      // A ridge is the one blocked tile that is not a building --
      // `buildings.ts`'s own doc comment says so explicitly, and skips
      // exactly it before ever asking whether a structure stands there.
      // Every OTHER blocked tile is a building or fence: `buildBuildings`'s
      // box already owns that ground entirely, so it gets no decor at all.
      // Mirrors `scatter.ts`'s own `if (blocked) { if (decorHere ===
      // DECOR_RIDGE) { ... } }` shape for its ridge grain.
      if (blocked[t] !== 0 && d !== DECOR_RIDGE) continue;
      const c = cover[t];
      const isBoulder = boulder ? boulder[t] !== 0 : false;
      const family = familyFor(d, c, tileHash(x + 977, y + 311), isBoulder);
      if (family === null) continue;

      const level = elevation ? elevation[t] : 0;

      // Cover level thickens a bush tile; every other family keeps its base
      // density. Clamped so a cover-3 tile cannot exceed 1.
      const density =
        family === 'bush' ? Math.min(1, DENSITY.bush * (0.5 + 0.5 * c)) : DENSITY[family];
      // Own offset stream, like every other roll in this file -- NOT the
      // bare `tileHash(x, y)` scatter.ts's ground grain uses for its own
      // pebble/fleck gate (`rnd > 0.9`, `rnd > 0.84`). Sharing that stream
      // anti-correlates decor density with grain density across the whole
      // map: a grass tuft (density 0.34) could never land on a tile grain
      // calls "pebbled" (>0.84), because the two ranges never overlap.
      if (tileHash(x + 449, y + 823) >= density) continue;

      // A ditch is placed, not scattered. Every other family below jitters
      // its position, rolls a variant, rolls a yaw and rolls a scale, which
      // is exactly right for a bush and exactly wrong for a segment of a
      // continuous earthwork: any one of those four would open a gap or an
      // overlap along the run. So this branch shares nothing with the code
      // after it but the tile loop itself.
      //
      // It sits BELOW the density gate rather than above it, and that is not
      // cosmetic: above it, `DENSITY.ditch` would be a constant with a
      // comment and no reader, and a later edit to 0.5 would punch holes in
      // every ditch on every map with nothing to catch it. Below it, 1.0 is
      // load-bearing -- `tileHash` returns strictly under 1, so the roll can
      // never skip a ditch tile, and lowering it fails a test.
      if (family === 'ditch') {
        for (const yawTurns of ditchYawTurns(decor, width, height, x, y)) {
          out.push({
            family: 'ditch',
            variant: DITCH_VARIANT,
            // The tile's exact centre. The segment is one tile long, so this
            // makes it span [x, x+1] precisely and abut its neighbours.
            x: x + 0.5,
            z: y + 0.5,
            y: level * WORLD_PER_LEVEL + DITCH_LIFT,
            yawTurns,
            scale: DITCH_SCALE,
          });
        }
        continue;
      }

      const jx = tileHash(x + 101, y + 7) - 0.5;
      const jy = tileHash(x + 13, y + 401) - 0.5;
      const scale = 0.8 + tileHash(x + 71, y + 137) * 0.4;
      out.push({
        family,
        variant: Math.floor(tileHash(x + 53, y + 991) * VARIANTS_PER_FAMILY),
        // WORLD space, not screen. `MeshData`'s own doc: "game tile (x, y) ->
        // (x, height, y)". `isoX`/`isoY` are the projection the CAMERA
        // applies -- baking them in here would project twice. Jitter is
        // therefore in tile units (+/-0.3 of a tile).
        x: x + 0.5 + jx * 0.6,
        z: y + 0.5 + jy * 0.6,
        // This tile's OWN elevation reading, exactly as `ground.ts` and
        // `scatter.ts` both use it (`scatter.ts`'s ridge rock-blob branch:
        // `topY = levelHere * WORLD_PER_LEVEL`, same tile, same array read).
        // Elevation is authored independently of the `^` symbol (`map.ts`:
        // "orthogonal to the terrain symbol on purpose"), and a real ridge's
        // elevation IS already raised above its surroundings -- Tel Marum's
        // authored grid reads elevation 3 at its ridge tiles against 1 on
        // the open ground beside them, the two-level rise CLAUDE.md's map
        // section describes for every blocking tile. So this already places
        // a slab on the ridge's own drawn top, not on the ground beneath
        // it: there is no separate "ridge top" height anywhere in this
        // renderer for it to miss -- the ground mesh has no per-tile bump
        // for `blocked`/ridge tiles beyond what the elevation grid says.
        y: level * WORLD_PER_LEVEL,
        yawTurns: tileHash(x + 617, y + 29),
        scale,
      });

      // A second, smaller tree on the same grove tile -- retiring the
      // procedural canopy (`grove.ts`, Task 7) means this is now the ONLY
      // place a grove tile's tree count is decided, so it reproduces
      // grove.ts's own twin rule exactly (`tileHash(x * 3, y * 7) > 0.62`,
      // second tree at 0.68 scale) rather than silently thinning every
      // grove to one tree per tile. Own hash stream (601/491, an offset
      // pair unused by any other roll in this file) so the second tree's
      // position/variant/yaw are independent draws, not a duplicate
      // stacked exactly on the first.
      if (family === 'tree' && tileHash(x * 3, y * 7) > 0.62) {
        const jx2 = tileHash(x + 601, y + 491) - 0.5;
        const jy2 = tileHash(x + 491, y + 601) - 0.5;
        out.push({
          family: 'tree',
          variant: Math.floor(tileHash(x + 601, y + 991) * VARIANTS_PER_FAMILY),
          x: x + 0.5 + jx2 * 0.6,
          z: y + 0.5 + jy2 * 0.6,
          y: level * WORLD_PER_LEVEL,
          yawTurns: tileHash(x + 601, y + 29),
          scale: scale * 0.68,
        });
      }
    }
  }
  return out;
}
