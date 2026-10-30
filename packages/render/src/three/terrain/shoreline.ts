/**
 * The marsh's ragged shoreline (GH-871 P2, S-6): the marsh floor's tone
 * bleeding across a tile edge, so the mud meets the fen along a wandering,
 * soft line rather than a tile staircase. PRESENTATION ONLY: the sim grid,
 * `applyTerrain` and every pin on them are untouched.
 *
 * Which layer made the hard edge. The marsh floor is not a control-map
 * weight: `tileSurface` gives a `~` tile the scrub albedo at strength 0.4,
 * and the control map already blends THAT across a 0.5-tile soft edge -- but
 * it only modulates the albedo image's contrast. The marsh COLOUR is a
 * per-tile vertex colour (`groundTone` -> `buildGround`), identical on every
 * vertex of a tile and shared with no neighbour, so it steps at the tile
 * line. (A road has no such step because its tile carries the OPEN wash and
 * the road tone is baked into control B's distance field.) Fixing it in the
 * control map would need a marsh weight the ground shader samples -- a shader
 * program change that moves every theme's digest -- so the fix is in the
 * vertex colours instead: a shoreline tile is emitted as the existing
 * `SURFACE_SUBDIVISIONS` patch and each vertex carries a MIX of the open and
 * marsh tones, weighted by `marshWeightAt`. Nothing in the shader program,
 * the control textures or the GroundMaterial uniforms changes.
 *
 * The weight is the control map's own recipe (`surfaceWeightsAt`): the query
 * point is wandered by noise, then the tiles in its 3x3 neighbourhood are
 * weighted by how much of a `SHORE_BAND_TILES`-wide window centred on it they
 * cover, and the sum is renormalised over the tiles that MAY take the marsh
 * tone. Tiles that may not -- a road or causeway, a ridge, a building pad --
 * are left out of the sum like a pad is in `surfaceWeightsAt`, and a vertex
 * of such a tile never reaches this function at all (`shoreTileMask` is
 * false for it), so nothing paints marsh tone over a causeway or a building,
 * and a marsh tile keeps its full tone right up to one. The wander is
 * bounded, so the tone reaches at most `SHORE_WANDER_TILES + SHORE_BAND_TILES
 * / 2` past the marsh boundary: a fraction of a tile.
 *
 * Inert by construction: a map with no `~` tile, or a theme with no
 * `marsh` tone (every shipped theme), selects no shoreline tile, and
 * `buildGround` runs its old path on every tile.
 *
 * Pure and three-free; deterministic noise from `fbm2` (no `Math.random`).
 */
import { fbm2 } from './noise';
import { DECOR_MARSH, DECOR_RIDGE, DECOR_ROAD } from './shared';
import type { TerrainInput } from './types';

/** Width, in tiles, of the soft band the marsh tone is blended across, as the
 *  control map's `EDGE_BAND_TILES`: centred on the (wandered) boundary, so it
 *  reaches half of it to each side. */
export const SHORE_BAND_TILES = 0.5;
/** The most, in tiles, the query point is moved off its straight-line
 *  position: the shoreline's ragged amplitude. Bounds the reach of the marsh
 *  tone past the marsh tiles to `SHORE_WANDER_TILES + SHORE_BAND_TILES / 2`. */
export const SHORE_WANDER_TILES = 0.45;
/** The wander noise's period in tiles (about one and a half), two octaves:
 *  bays and capes a tile or two across with a finer fringe on them. */
export const SHORE_WANDER_PERIOD_TILES = 1.6;
export const SHORE_WANDER_OCTAVES = 2;
/** The wander's two seeds, one per axis. Distinct from every other seed in
 *  this directory (`marshWaterAt` 6101/6203, the control map's 101/202/303). */
const SHORE_SEED_X = 6307;
const SHORE_SEED_Z = 6409;

/** Can tile `ti` take the marsh tone (as marsh itself, or as the open fen
 *  beside it)? A road or causeway, a ridge and a building pad cannot: they
 *  are drawn from their own rules and are never lapped. */
function takesMarshTone(input: TerrainInput, decor: Uint8Array, ti: number): boolean {
  if (input.blocked[ti] !== 0) return false;
  const d = decor[ti];
  return d !== DECOR_ROAD && d !== DECOR_RIDGE;
}

/**
 * Per tile, 1 where the tile's ground is drawn as a patch of mixed tones: a
 * tile that takes the marsh tone and has a neighbour (of its eight) of the
 * other kind -- a `~` tile beside a tile that is not, or a tile that is not
 * beside a `~` tile -- because only there can the weight leave 0 or 1. The
 * wander and the band reach less than a tile, so a marsh tile ringed by marsh
 * and a fen tile with no marsh near are plain, and draw as the quads they
 * always did. `null` when the map has no `~` tile at all, so a caller can
 * tell "nothing to do" from "all zero" without a scan. A neighbour off the
 * map counts as neither: the weight skips it.
 */
export function shoreTileMask(input: TerrainInput): Uint8Array | null {
  const decor = input.decor;
  if (!decor) return null;
  const { width, height } = input;
  let any = false;
  for (let t = 0; t < width * height; t++) {
    if (decor[t] === DECOR_MARSH) {
      any = true;
      break;
    }
  }
  if (!any) return null;
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const ti = y * width + x;
      if (!takesMarshTone(input, decor, ti)) continue;
      const marsh = decor[ti] === DECOR_MARSH;
      let other = false;
      for (let dz = -1; dz <= 1 && !other; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const nz = y + dz;
          if ((dx === 0 && dz === 0) || nx < 0 || nz < 0 || nx >= width || nz >= height) continue;
          if ((decor[nz * width + nx] === DECOR_MARSH) !== marsh) {
            other = true;
            break;
          }
        }
      }
      if (other) mask[ti] = 1;
    }
  }
  return mask;
}

/** The fraction of the `SHORE_BAND_TILES`-wide window centred on `q` that
 *  falls inside tile `t`'s span `[t, t + 1]`. */
function bandOverlap(q: number, t: number): number {
  const half = SHORE_BAND_TILES / 2;
  const lo = Math.max(q - half, t);
  const hi = Math.min(q + half, t + 1);
  return Math.max(0, hi - lo) / SHORE_BAND_TILES;
}

/**
 * How much of the marsh tone world point `(px, pz)` carries, in `[0, 1]`:
 * 1 well inside the marsh, 0 well outside it, and in between across a
 * wandering band about `SHORE_BAND_TILES` wide. `homeMarsh` is the answer for
 * a point whose whole window lies on tiles that may not take the tone (the
 * point's own tile's verdict), so a marsh tile beside a causeway stays marsh.
 *
 * A pure function of the world point and the map: two tiles' shared edge
 * vertices agree to the bit, so there is no seam between neighbouring
 * shoreline tiles.
 */
export function marshWeightAt(input: TerrainInput, px: number, pz: number, homeMarsh: boolean): number {
  const decor = input.decor;
  if (!decor) return 0;
  const qx = px + SHORE_WANDER_TILES * fbm2(px, pz, SHORE_WANDER_PERIOD_TILES, SHORE_WANDER_OCTAVES, SHORE_SEED_X);
  const qz = pz + SHORE_WANDER_TILES * fbm2(px, pz, SHORE_WANDER_PERIOD_TILES, SHORE_WANDER_OCTAVES, SHORE_SEED_Z);
  const baseX = Math.floor(qx);
  const baseZ = Math.floor(qz);
  let all = 0;
  let marsh = 0;
  for (let dz = -1; dz <= 1; dz++) {
    const tz = baseZ + dz;
    if (tz < 0 || tz >= input.height) continue;
    for (let dx = -1; dx <= 1; dx++) {
      const tx = baseX + dx;
      if (tx < 0 || tx >= input.width) continue;
      const ti = tz * input.width + tx;
      if (!takesMarshTone(input, decor, ti)) continue;
      const overlap = bandOverlap(qx, tx) * bandOverlap(qz, tz);
      if (overlap <= 0) continue;
      all += overlap;
      if (decor[ti] === DECOR_MARSH) marsh += overlap;
    }
  }
  if (all <= 0) return homeMarsh ? 1 : 0;
  return marsh / all;
}

/** `open` and `marsh` mixed by `weight`, componentwise. The two endpoints are
 *  returned as themselves (not as `a + (b - a) * w`), so a vertex that is
 *  wholly one tone carries that palette entry bit for bit. */
export function mixTones(
  open: readonly [number, number, number],
  marsh: readonly [number, number, number],
  weight: number
): [number, number, number] {
  if (weight <= 0) return [open[0], open[1], open[2]];
  if (weight >= 1) return [marsh[0], marsh[1], marsh[2]];
  return [
    open[0] + (marsh[0] - open[0]) * weight,
    open[1] + (marsh[1] - open[1]) * weight,
    open[2] + (marsh[2] - open[2]) * weight,
  ];
}
