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
 * **The straddle case: the road is exact, the tile tone is not.** A crater
 * lip lies 0.34-0.60 tiles out, which for a crater centred on a road is the
 * road's own edge and shoulder -- the straddle case every time, not now and
 * then (fix wave I-3). Dividing the whole mark by the road tone at its centre
 * drew that lip over the shoulder at (238, 240, 261) sRGB instead of (189,
 * 157, 117): a green map's shoulder is far bluer than its `dust.3` road, and
 * the ratio multiplied blue eightfold. So the decal SHADER now mixes the road
 * and shoulder in per fragment, from the same control B texel the ground
 * reads (`decalRoadMix` is its mirror), and only the tile's own palette tone
 * is per decal (`decalBaseTone`, written into `aGround` at the stamp). A decal
 * straddling two TILE tones -- grass and a cover tile -- still divides both
 * halves by its centre tile's tone. That is the accepted part: it mirrors
 * `ground.ts`'s own per-tile tone, and a cover tier reads as texture, not a
 * tint, so the two tones are close.
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

type Rgb = [number, number, number];

/** Everything the local tone reads, retained by the renderer from its last
 *  terrain build (and its draw mask refreshed when a structure falls). Built
 *  through `makeDecalGroundSource`, which resolves the two road tones once
 *  rather than per stamp (fix wave M-4). */
export interface DecalGroundSource {
  readonly input: TerrainInput;
  readonly tones: TerrainTones;
  readonly background: string;
  /** The road shoulder's tone -- `limestone.2`, as bound to `uShoulderTone`. */
  readonly shoulder: string;
  readonly graph: RoadGraph;
  /** `tones.road` and `shoulder`, linear, resolved once. */
  readonly roadLinear: Rgb;
  readonly shoulderLinear: Rgb;
  /** Linear tile tones by hex, filled on first use: a map has a handful. */
  readonly baseCache: Map<string, Rgb>;
}

export function makeDecalGroundSource(
  input: TerrainInput,
  tones: TerrainTones,
  background: string,
  shoulder: string,
  graph: RoadGraph
): DecalGroundSource {
  return {
    input,
    tones,
    background,
    shoulder,
    graph,
    roadLinear: hexToLinear(tones.road),
    shoulderLinear: hexToLinear(shoulder),
    baseCache: new Map(),
  };
}

/**
 * The tile's own palette tone under world point `(x, z)`, linear, with NO
 * road mixed in -- what `DecalPool.stamp` writes into `aGround` (fix wave
 * I-3). The road and its shoulder are mixed in per FRAGMENT by the decal
 * shader from the same control B the ground reads (`decalRoadMix` is its
 * mirror), so a crater lip lying on a road's shoulder divides by the
 * shoulder it lies on rather than by the road at the crater's centre.
 */
export function decalBaseTone(src: DecalGroundSource, x: number, z: number): Rgb {
  const { input } = src;
  const tx = Math.min(input.width - 1, Math.max(0, Math.floor(x)));
  const tz = Math.min(input.height - 1, Math.max(0, Math.floor(z)));
  const hex = tileBaseToneHex(input, src.tones, tz * input.width + tx, src.background);
  let rgb = src.baseCache.get(hex);
  if (rgb === undefined) {
    rgb = hexToLinear(hex);
    src.baseCache.set(hex, rgb);
  }
  return rgb;
}

/**
 * The decal shader's divisor, in TypeScript: `base` with the road surface and
 * its shoulder mixed in exactly as `GroundMaterial` mixes them, from control
 * B's road distance and edge bend as the shader samples them (`bG`, `bA` in
 * [0, 1]). `decal-pool.ts`'s `DECAL_FRAGMENT_SHADER` is its transcription.
 * The junction distance feeds only the ruts, which are left out (above).
 */
export function decalRoadMix(base: readonly number[], road: readonly number[], shoulder: readonly number[], bG: number, bA: number): Rgb {
  const p = roadProfile(bG * ROAD_DISTANCE_RANGE_TILES, bA * 2 - 1, ROAD_DISTANCE_RANGE_TILES);
  const out: Rgb = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const withRoad = base[c] + (road[c] - base[c]) * p.surface;
    out[c] = withRoad + (shoulder[c] - withRoad) * p.shoulder;
  }
  return out;
}

/** The ground's base albedo at world tile point `(x, z)`, linear RGB: the
 *  tile tone with the road mixed in at that exact point, read from the
 *  distance itself rather than the control map's bytes. */
export function decalGroundTone(src: DecalGroundSource, x: number, z: number): Rgb {
  const base = decalBaseTone(src, x, z);
  // The road, as the shader reads it: a distance saturating at
  // ROAD_DISTANCE_RANGE_TILES, and the wander control B stores as
  // `0.5 + 0.5 * noise` and the shader decodes back to `noise`.
  const d = Math.min(roadDistanceAt(src.graph, x, z), ROAD_DISTANCE_RANGE_TILES);
  const bend = valueNoise2(x, z, ROAD_EDGE_BEND_CYCLES, ROAD_BEND_SEED);
  return decalRoadMix(base, src.roadLinear, src.shoulderLinear, d / ROAD_DISTANCE_RANGE_TILES, 0.5 + 0.5 * bend);
}
