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
      if (blocked[t] !== 0) continue;
      const c = cover[t];
      const d = decor ? decor[t] : 0;
      const family = familyFor(d, c, tileHash(x + 977, y + 311));
      if (family === null) continue;

      // Cover level thickens a bush tile; every other family keeps its base
      // density. Clamped so a cover-3 tile cannot exceed 1.
      const density =
        family === 'bush' ? Math.min(1, DENSITY.bush * (0.5 + 0.5 * c)) : DENSITY[family];
      if (tileHash(x, y) >= density) continue;

      const jx = tileHash(x + 101, y + 7) - 0.5;
      const jy = tileHash(x + 13, y + 401) - 0.5;
      const level = elevation ? elevation[t] : 0;
      out.push({
        family,
        variant: Math.floor(tileHash(x + 53, y + 991) * VARIANTS_PER_FAMILY),
        // WORLD space, not screen. `MeshData`'s own doc: "game tile (x, y) ->
        // (x, height, y)". `isoX`/`isoY` are the projection the CAMERA
        // applies -- baking them in here would project twice. Jitter is
        // therefore in tile units (+/-0.3 of a tile).
        x: x + 0.5 + jx * 0.6,
        z: y + 0.5 + jy * 0.6,
        y: level * WORLD_PER_LEVEL,
        yawTurns: tileHash(x + 617, y + 29),
        scale: 0.8 + tileHash(x + 71, y + 137) * 0.4,
      });
    }
  }
  return out;
}
