/**
 * The ground tone under a decal (Task 12 fix round 2): the denominator of the
 * decal pool's albedo ratio (`decal-pool.ts`, `decalMultiplier`).
 *
 * A decal is multiplied onto the LIT ground as `1 + a * (decal / ground - 1)`,
 * which reproduces the decal's own palette colour at `a = 1` only when
 * `ground` is the albedo the ground actually drew there. Dividing by the
 * map's `open` tone everywhere was wrong wherever the ground is not open: on
 * a green map's road (`dust.3` against `grass.2`) a crater lip drew salmon and
 * tyre prints drew red. So each decal carries its own local tone, captured at
 * the stamp, and this is the one function that computes it.
 *
 * What it composes is exactly what `GroundMaterial` holds in `diffuseColor`
 * BEFORE the ratio fields: the tile top's vertex palette tone
 * (`tileBaseToneHex`, the same function `buildGround` colours the vertex
 * with), then the road surface and its bleached shoulder mixed in by the same
 * `roadProfile` the shader transcribes, reading the same road distance and
 * the same edge wander (`ROAD_BEND_SEED`). Left out, deliberately:
 *
 * - The albedo images and the macro field. Both are RATIO fields whose mean
 *   is 1 by construction (`GROUND_ALBEDOS`, `macroFactor`); they vary the
 *   ground around its palette tone, and a decal multiplied onto that ground
 *   inherits the same variation -- which is the point of the ratio model.
 * - The ruts. A 0.06-tile line broken by the grain texture is a detail the
 *   decal's single centre sample should not lock onto: a tyre print whose
 *   centre happened to land on a rut would be divided by a darker tone than
 *   the rest of its footprint stands on.
 *
 * **The straddle case is a known, accepted limitation, not an oversight.**
 * A decal takes exactly ONE ground tone -- this function's own return value,
 * sampled once at the decal's own centre `(x, z)` -- and `DecalPool.stamp`
 * writes that single tone onto every vertex of the decal's grid (`aGround`).
 * A decal that physically straddles two different surfaces (a scorch mark
 * half on the road, half on open grass) therefore divides its ENTIRE
 * footprint by whichever surface its centre happens to sit on: the grass
 * half of that mark is divided by the road's tone, not its own, and reads
 * off. This mirrors `ground.ts`'s own per-TILE (not per-vertex) tone
 * decision -- a decal is smaller than the band this could visibly matter
 * over, and a per-vertex sample would need the same control-map lookup the
 * shader itself does, which is exactly the fragment-level machinery this
 * function's single centre sample exists to avoid paying twice.
 *
 * Linear light throughout (`hexToLinear`), like the shader's.
 *
 * The shader reads the road through the control map, 8 texels a tile and 8
 * bits a channel, bilinearly; this reads the distance exactly. The two agree
 * to that quantisation, which is the "within rounding" the green-map test
 * (`tools/src/decal-ground-tone.test.ts`) holds them to.
 */
import type { TerrainTones } from '../../api';
import { tileBaseToneHex } from './ground';
import { ROAD_BEND_SEED, ROAD_DISTANCE_RANGE_TILES } from './control-map';
import { valueNoise2 } from './noise';
import { roadDistanceAt, roadProfile, ROAD_EDGE_BEND_CYCLES, type RoadGraph } from './road-graph';
import { hexToLinear } from './shared';
import type { TerrainInput } from './types';

/** Everything the local tone reads, retained by the renderer from its last
 *  terrain build (and its draw mask refreshed when a structure falls). */
export interface DecalGroundSource {
  readonly input: TerrainInput;
  readonly tones: TerrainTones;
  readonly background: string;
  /** The road shoulder's tone -- `limestone.2`, as bound to `uShoulderTone`. */
  readonly shoulder: string;
  readonly graph: RoadGraph;
}

/** The ground's base albedo at world tile point `(x, z)`, linear RGB. */
export function decalGroundTone(src: DecalGroundSource, x: number, z: number): [number, number, number] {
  const { input } = src;
  const tx = Math.min(input.width - 1, Math.max(0, Math.floor(x)));
  const tz = Math.min(input.height - 1, Math.max(0, Math.floor(z)));
  const base = hexToLinear(tileBaseToneHex(input, src.tones, tz * input.width + tx, src.background));

  // The road, as the shader reads it: a distance saturating at
  // ROAD_DISTANCE_RANGE_TILES, and the wander control B stores as
  // `0.5 + 0.5 * noise` and the shader decodes back to `noise`.
  const d = Math.min(roadDistanceAt(src.graph, x, z), ROAD_DISTANCE_RANGE_TILES);
  const bend = valueNoise2(x, z, ROAD_EDGE_BEND_CYCLES, ROAD_BEND_SEED);
  // The junction distance feeds only the ruts, which are left out (above).
  const p = roadProfile(d, bend, ROAD_DISTANCE_RANGE_TILES);
  const road = hexToLinear(src.tones.road);
  const shoulder = hexToLinear(src.shoulder);
  const out: [number, number, number] = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const withRoad = base[c] + (road[c] - base[c]) * p.surface;
    out[c] = withRoad + (shoulder[c] - withRoad) * p.shoulder;
  }
  return out;
}
