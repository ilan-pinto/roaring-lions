/**
 * GH-1225 rim (lead ruling 13 Nov, variant B): how much wall a cut keeps, per structure type.
 *
 * A cut keeps `CUT_RIM_WALL_TILES` (0.9 t) of wall, so a cut building still reads as a house. But a building with an upper floor has
 * a slab across its footprint above the ground storey; a rim at or above that slab's underside leaves the slab standing, and it
 * hides the men on the ground floor (measured on the house: ceiling 1.28 t, a 1.37 t cut left a floor over the garrison). So the
 * kept height is `min(0.9 t, lowest slab - margin)`, the margin covering the ragged top's amplitude, measured ONCE per
 * type from the drawn geometry (`lowestSlabBottom`), never authored, so a new building cannot forget it.
 *
 * A slab is a set of HORIZONTAL triangles (facing up or down) at one height whose area is a fair share of the footprint: a window
 * sill or a lintel is far under it. Both facings count because a flat roof ships as a single up-facing plane with no underside
 * (the hall's deck at 0.87 t, the clinic's at 1.27 t), and the cut must go below it; a floor slab has both, and its underside is
 * the lower. The lowest such height is the slab. Import-free, presentation only.
 */
import { CUT_HEIGHT_TILES, CUT_RIM_JITTER_TILES, CUT_RIM_WALL_TILES } from './building-cutaway';

/** The kept height stays this far under a slab's underside, tiles: the ragged top's full amplitude plus a hand's width. */
export const CUT_RIM_MARGIN_TILES = CUT_RIM_JITTER_TILES + 0.04;
/** A horizontal surface under this height is the floor, a foundation or a step, not a slab. */
export const SLAB_MIN_HEIGHT_TILES = 0.5;
/** A slab's area, as a share of the footprint's bounding rectangle, at least. */
export const SLAB_MIN_AREA_SHARE = 0.2;
/** A triangle is horizontal (a deck, up or down) when the magnitude of its unit normal's y is over this. */
export const SLAB_FACING = 0.95;
/** Heights are bucketed to this, tiles. */
export const SLAB_BUCKET_TILES = 0.04;

/**
 * The height of the lowest slab (horizontal deck) in a mesh set, `Infinity` when there is none. `positions` is WORLD-space xyz triples,
 * `index` the triangle list (null: sequential triples), `baseY` the ground the building stands on (heights returned above it).
 */
export function lowestSlabBottom(positions: ArrayLike<number>, index: ArrayLike<number> | null, baseY: number): number {
  const n = index === null ? Math.floor(positions.length / 9) : Math.floor(index.length / 3);
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    minX = Math.min(minX, positions[i]);
    maxX = Math.max(maxX, positions[i]);
    minZ = Math.min(minZ, positions[i + 2]);
    maxZ = Math.max(maxZ, positions[i + 2]);
  }
  const footprint = (maxX - minX) * (maxZ - minZ);
  if (!(footprint > 0)) return Infinity;
  const area = new Map<number, number>();
  for (let t = 0; t < n; t++) {
    const a = (index === null ? 3 * t : index[3 * t]) * 3;
    const b = (index === null ? 3 * t + 1 : index[3 * t + 1]) * 3;
    const c = (index === null ? 3 * t + 2 : index[3 * t + 2]) * 3;
    const ux = positions[b] - positions[a];
    const uy = positions[b + 1] - positions[a + 1];
    const uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a];
    const vy = positions[c + 1] - positions[a + 1];
    const vz = positions[c + 2] - positions[a + 2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len === 0 || Math.abs(ny) / len < SLAB_FACING) continue;
    const y = (positions[a + 1] + positions[b + 1] + positions[c + 1]) / 3 - baseY;
    if (y < SLAB_MIN_HEIGHT_TILES) continue;
    const key = Math.round(y / SLAB_BUCKET_TILES);
    area.set(key, (area.get(key) ?? 0) + len / 2);
  }
  let best = Infinity;
  for (const [key, a] of area) if (a >= SLAB_MIN_AREA_SHARE * footprint) best = Math.min(best, key * SLAB_BUCKET_TILES);
  return best;
}

/** The wall a cut keeps for a type whose lowest slab is `slabBottom` (`Infinity`: none): never over
 *  `CUT_RIM_WALL_TILES`, never under `CUT_HEIGHT_TILES / 2`. */
export function keptWallHeight(slabBottom: number): number {
  return Math.max(CUT_HEIGHT_TILES / 2, Math.min(CUT_RIM_WALL_TILES, slabBottom - CUT_RIM_MARGIN_TILES));
}
