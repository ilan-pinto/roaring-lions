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
import { DECOR_GROVE, DECOR_KNOLL, DECOR_RIDGE, DECOR_ROAD, WORLD_PER_LEVEL } from './shared';
import type { TerrainInput } from './types';

export type DecorFamily = 'grass' | 'sand' | 'bush' | 'tree' | 'rock' | 'slab';

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
 *  with their level, so a cover-3 thicket reads denser than a cover-1 verge. */
const DENSITY: Record<DecorFamily, number> = {
  grass: 0.34,
  sand: 0.18,
  bush: 0.3,
  tree: 1.0,
  rock: 0.75,
  slab: 0.6,
};

/** Which family this tile offers, or null for "nothing grows here". */
function familyFor(decor: number, cover: number, roll: number): DecorFamily | null {
  if (decor === DECOR_ROAD) return null;
  if (decor === DECOR_GROVE) return 'tree';
  if (decor === DECOR_KNOLL) return 'rock';
  if (decor === DECOR_RIDGE) return 'slab';
  if (cover > 0) return 'bush';
  return roll < 0.6 ? 'grass' : 'sand';
}

export function decorPlacements(input: TerrainInput): DecorPlacement[] {
  const { width, height, blocked, cover, decor, elevation } = input;
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
      const family = familyFor(d, c, tileHash(x + 977, y + 311));
      if (family === null) continue;

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

      const jx = tileHash(x + 101, y + 7) - 0.5;
      const jy = tileHash(x + 13, y + 401) - 0.5;
      const level = elevation ? elevation[t] : 0;
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
