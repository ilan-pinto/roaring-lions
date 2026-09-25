/**
 * The ground's control map: a per-texel record of which of the ground's
 * albedo surfaces a fragment sits on, and how strongly -- Task 4a of
 * `docs/superpowers/sdd/2026-09-25-ground-plan-1`.
 *
 * `ground.ts`'s `albedoFor` makes one per-TILE decision and writes it
 * identically to every vertex of that tile -- the palette guarantee `ground.ts`
 * itself documents at length. A control map is the opposite kind of object: a
 * dense `CONTROL_TEXELS_PER_TILE`-per-tile texture, sampled by the fragment
 * shader `ground.ts` does not touch, whose whole reason to exist is to
 * SOFTEN the edge between two neighbouring tiles' surfaces rather than
 * cutting hard at the tile line. `tileSurface` is `albedoFor`'s decision
 * restated as data (kind + strength) rather than as an `Albedo` record, and
 * it is the one place that decision is made -- `surfaceWeightsAt` calls it
 * for every tile it touches rather than re-deriving the order.
 *
 * Two kinds are deliberately hard, never blended: `tileSurface`'s `'pad'`
 * (a building footprint -- not ground at all) and `'rock'` (a `^` ridge
 * top). Blending a building edge into the sand around it would draw a
 * footprint bleeding past its own walls; blending a ridge top down to sand
 * would draw a cliff face melting into the ground it stands on. Both are
 * "terraces" in the sense `surface.ts` already uses the word for: flat,
 * bounded, and drawn with a hard edge. A ridge's OWN hard edge is not the end
 * of the story, though -- `APRON_TILES` still walks up to half a tile of rock
 * onto the OPEN ground beside it (never the reverse), because a ridge is
 * bedrock and the ground touching it is naturally littered with the same
 * stone, not a a clean line between two materials. See `surfaceWeightsAt`'s
 * step 5 doc for the mechanics.
 *
 * This file is Task 4a only. `heightBiased`, `HEIGHT_BLEND`, the `MACRO_*`
 * family and the macro tint helpers are Task 4b's addition to this same
 * file, appended rather than redesigned around -- the split exists purely
 * because Task 4's combined size crosses the controller's file cap, not
 * because the two halves are independent ideas.
 */
import { DECOR_GROVE, DECOR_KNOLL, DECOR_RIDGE, DECOR_ROAD } from './shared';
import { SCRUB_TIER_STRENGTH } from './ground';
import { valueNoise2 } from './noise';
import { buildRoadGraph, junctionDistanceAt, roadDistanceAt, ROAD_EDGE_BEND_CYCLES } from './road-graph';
import type { TerrainInput } from './types';

/** Texels per tile side, in EITHER control texture. `CONTROL_TEXELS_PER_TILE
 *  x CONTROL_TEXELS_PER_TILE` texels cover one tile, so an 8x8 map is a
 *  64x64 texture. */
export const CONTROL_TEXELS_PER_TILE = 8;

/** Width, in tiles, of the soft band a tile's own surface is blended across
 *  at its edge -- centred ON the tile edge, so it reaches `EDGE_BAND_TILES /
 *  2` into each of the two neighbouring tiles. D1: the plan's own text said
 *  1.5 tiles; a lone cover tile at that width smeared past recognition, so
 *  the shipped value is 0.5 and `control-map.test.ts`'s D1 case is the
 *  falsification that rejects 1.5. */
export const EDGE_BAND_TILES = 0.5;
/** How far, in tiles, the query point itself is allowed to wander off its
 *  straight-line position before the band is measured -- what keeps every
 *  tile edge in the control map from reading as a ruler-straight line. */
export const EDGE_BEND_TILES = 0.2;
/** `valueNoise2` cycles-per-tile the edge-bend jitter is sampled at. */
export const EDGE_BEND_CYCLES_PER_TILE = 1.5;
/** How far, in tiles, a ridge's rock apron reaches onto the open ground
 *  beside it. */
export const APRON_TILES = 0.5;
/** The distance, in tiles, at which the road-distance and junction-distance
 *  control channels saturate to 1 (fully "far"). */
export const ROAD_DISTANCE_RANGE_TILES = 1;

/** The seven things `tileSurface` can call a tile. `'pad'` is a building
 *  footprint -- not ground, and carries no channel of its own in either
 *  control texture. */
export type SurfaceKind = 'open' | 'road' | 'rock' | 'scrub' | 'grove' | 'knoll' | 'pad';

export interface TileSurface {
  readonly kind: SurfaceKind;
  readonly strength: number;
}

/**
 * The one per-tile decision, restated from `ground.ts`'s `albedoFor`
 * (`ground.ts:228-243`) rather than re-derived: blocked tiles first (a `^`
 * ridge is rock, everything else blocked is a bare pad), then road, then
 * grove, then knoll, then a plain cover tier as scrub at its tier's
 * strength, and open ground last. `albedoFor` is deleted in Task 7 and its
 * callers move to this function; until then the two copies coexist; and
 * `packages/app/src/ground-texture-slots.test.ts` pins that they agree on
 * every shipped map.
 */
export function tileSurface(input: TerrainInput, x: number, y: number): TileSurface {
  const ti = y * input.width + x;
  const decorHere = input.decor ? input.decor[ti] : 0;
  if (input.blocked[ti] !== 0) return decorHere === DECOR_RIDGE ? { kind: 'rock', strength: 1 } : { kind: 'pad', strength: 0 };
  if (decorHere === DECOR_ROAD) return { kind: 'road', strength: 1 };
  if (decorHere === DECOR_GROVE) return { kind: 'grove', strength: 1 };
  if (decorHere === DECOR_KNOLL) return { kind: 'knoll', strength: 1 };
  // DECOR none is 0, same reasoning as `albedoFor`: "no decor" is the
  // absence of an entry rather than a kind of its own.
  const tier = decorHere === 0 ? input.cover[ti] : 0;
  if (tier > 0) return { kind: 'scrub', strength: SCRUB_TIER_STRENGTH[Math.min(tier, 3) - 1] };
  return { kind: 'open', strength: 1 };
}

export interface SurfaceWeights {
  readonly open: number;
  readonly rock: number;
  readonly scrub: number;
  readonly grove: number;
  readonly knoll: number;
}

const ZERO_WEIGHTS: SurfaceWeights = { open: 0, rock: 0, scrub: 0, grove: 0, knoll: 0 };

/** A road tile is open ground in control A -- the sand runs on under the
 *  road's worn edge and shoulder (R-3). The road surface itself is baked
 *  from `roadDistanceAt` into control B, not from this weight. */
type BlendKind = 'open' | 'scrub' | 'grove' | 'knoll';
function blendChannel(kind: SurfaceKind): BlendKind | null {
  if (kind === 'open' || kind === 'road') return 'open';
  if (kind === 'scrub' || kind === 'grove' || kind === 'knoll') return kind;
  return null; // 'pad' and 'rock' are terraces -- handled outside the blend.
}

/** A tile's own weights with nothing borrowed from a neighbour -- what a
 *  hard terrace returns immediately (step 1), and what an isolated tile
 *  falls back to when no neighbour overlaps it at all (step 6). */
function oneHot(s: TileSurface): SurfaceWeights {
  if (s.kind === 'pad') return ZERO_WEIGHTS;
  if (s.kind === 'rock') return { ...ZERO_WEIGHTS, rock: s.strength };
  const channel = blendChannel(s.kind);
  // `channel` cannot be null here: every remaining kind (open/road/scrub/
  // grove/knoll) maps to one of the four blend channels.
  return { ...ZERO_WEIGHTS, [channel as BlendKind]: s.strength };
}

/** The fraction of the `EDGE_BAND_TILES`-wide window centred on `q` that
 *  falls inside tile `t`'s span `[t, t + 1]`. 0 when the window misses the
 *  tile entirely, up to 1 when the whole window is inside it. */
function bandOverlap(q: number, t: number): number {
  const half = EDGE_BAND_TILES / 2;
  const lo = Math.max(q - half, t);
  const hi = Math.min(q + half, t + 1);
  return Math.max(0, hi - lo) / EDGE_BAND_TILES;
}

/** Euclidean distance from point `(qx, qz)` to the axis-aligned rectangle
 *  `[tx, tx + 1] x [tz, tz + 1]` -- 0 when the point is inside it. */
function distanceToTileRect(qx: number, qz: number, tx: number, tz: number): number {
  const dx = Math.max(tx - qx, 0, qx - (tx + 1));
  const dz = Math.max(tz - qz, 0, qz - (tz + 1));
  return Math.hypot(dx, dz);
}

/**
 * The control-A weights (plus the knoll weight, control B's own channel 0)
 * at world point `(px, pz)`. `ground.ts`'s tile decision, softened at the
 * edges:
 *
 *  1. A pad or a ridge tile at `(floor(px), floor(pz))` returns its own
 *     one-hot at once -- terraces are hard, never blended into or out of.
 *  2. Otherwise the query point is jittered by up to `EDGE_BEND_TILES`
 *     along each axis, independently, so a long straight tile edge does not
 *     read as a ruled line in the control map.
 *  3. For each non-terrace tile in the 3x3 neighbourhood of the jittered
 *     point, `bandOverlap` on both axes weights that tile's contribution to
 *     its own blend channel (road folds into open -- R-3).
 *  4. The weighted sums are renormalised by the summed overlap, which is
 *     what keeps open ground reading at full strength right up to a pad's
 *     edge (R-4): a pad contributes nothing to the sum, so the open tile
 *     beside it is divided by its own overlap alone.
 *  5. A ridge's apron is computed independently of the blend above (it
 *     multiplies the blend result rather than joining its sum): the
 *     strongest `1 - distance/APRON_TILES` over every ridge tile in the same
 *     3x3 neighbourhood becomes the rock weight outright, and the other four
 *     weights are scaled down by `1 - apron` so the total stays 1.
 *  6. If no neighbour overlaps the jittered point at all (every tile in the
 *     3x3 window is a terrace), the blend falls back to the ORIGINAL tile's
 *     own one-hot rather than dividing by zero.
 */
export function surfaceWeightsAt(input: TerrainInput, px: number, pz: number): SurfaceWeights {
  const homeX = Math.floor(px);
  const homeZ = Math.floor(pz);
  const home = tileSurface(input, homeX, homeZ);
  if (home.kind === 'pad' || home.kind === 'rock') return oneHot(home);

  const qx = px + EDGE_BEND_TILES * valueNoise2(px, pz, EDGE_BEND_CYCLES_PER_TILE, 101);
  const qz = pz + EDGE_BEND_TILES * valueNoise2(px, pz, EDGE_BEND_CYCLES_PER_TILE, 202);
  const baseX = Math.floor(qx);
  const baseZ = Math.floor(qz);

  const sums = { open: 0, scrub: 0, grove: 0, knoll: 0 };
  let overlapSum = 0;
  let apron = 0;

  for (let dz = -1; dz <= 1; dz++) {
    const tz = baseZ + dz;
    if (tz < 0 || tz >= input.height) continue;
    for (let dx = -1; dx <= 1; dx++) {
      const tx = baseX + dx;
      if (tx < 0 || tx >= input.width) continue;
      const s = tileSurface(input, tx, tz);
      if (s.kind === 'rock') {
        const dist = distanceToTileRect(qx, qz, tx, tz);
        apron = Math.max(apron, Math.max(0, 1 - dist / APRON_TILES));
        continue;
      }
      if (s.kind === 'pad') continue;
      const overlap = bandOverlap(qx, tx) * bandOverlap(qz, tz);
      if (overlap <= 0) continue;
      overlapSum += overlap;
      const channel = blendChannel(s.kind) as BlendKind;
      sums[channel] += overlap * s.strength;
    }
  }

  const blended: SurfaceWeights =
    overlapSum > 0
      ? {
          open: sums.open / overlapSum,
          rock: 0,
          scrub: sums.scrub / overlapSum,
          grove: sums.grove / overlapSum,
          knoll: sums.knoll / overlapSum,
        }
      : oneHot(home);

  if (apron <= 0) return blended;
  const keep = 1 - apron;
  return {
    open: blended.open * keep,
    rock: apron,
    scrub: blended.scrub * keep,
    grove: blended.grove * keep,
    knoll: blended.knoll * keep,
  };
}

export interface ControlMap {
  readonly width: number;
  readonly height: number;
  /** open, rock, scrub, grove -- one byte each, RGBA order. */
  readonly a: Uint8Array;
  /** knoll, road distance, junction distance, road-edge bend -- one byte
   *  each, RGBA order. */
  readonly b: Uint8Array;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function byteOf(v: number): number {
  return Math.round(clamp01(v) * 255);
}

/**
 * Builds both control textures at `CONTROL_TEXELS_PER_TILE` texels a tile,
 * sampling every builder above at each texel's own centre
 * `((i + 0.5) / CONTROL_TEXELS_PER_TILE, (j + 0.5) / CONTROL_TEXELS_PER_TILE)`.
 *
 * One `buildRoadGraph` per call, shared by every texel's road- and
 * junction-distance sample -- rebuilding it per texel would repeat the same
 * O(tiles) graph walk 64 times over for nothing. Cost: `width * height`
 * texels, each a 3x3 `tileSurface` walk (`surfaceWeightsAt`) plus two
 * `+/-2`-tile road-graph window queries; Task 5 measures this on the largest
 * shipped map and must keep it under 60 ms, or `rebuildTerrain` needs a
 * dirty region -- reported there, not solved here.
 */
export function buildControlMap(input: TerrainInput): ControlMap {
  const N = CONTROL_TEXELS_PER_TILE;
  const width = input.width * N;
  const height = input.height * N;
  const a = new Uint8Array(width * height * 4);
  const b = new Uint8Array(width * height * 4);
  const graph = buildRoadGraph(input);

  for (let j = 0; j < height; j++) {
    const pz = (j + 0.5) / N;
    for (let i = 0; i < width; i++) {
      const px = (i + 0.5) / N;
      const w = surfaceWeightsAt(input, px, pz);
      const o = (j * width + i) * 4;

      a[o] = byteOf(w.open);
      a[o + 1] = byteOf(w.rock);
      a[o + 2] = byteOf(w.scrub);
      a[o + 3] = byteOf(w.grove);

      const roadDist = roadDistanceAt(graph, px, pz);
      const juncDist = junctionDistanceAt(graph, px, pz);
      const bend = 0.5 + 0.5 * valueNoise2(px, pz, ROAD_EDGE_BEND_CYCLES, 303);
      b[o] = byteOf(w.knoll);
      b[o + 1] = byteOf(Math.min(1, roadDist / ROAD_DISTANCE_RANGE_TILES));
      b[o + 2] = byteOf(Math.min(1, juncDist / ROAD_DISTANCE_RANGE_TILES));
      b[o + 3] = byteOf(bend);
    }
  }

  return { width, height, a, b };
}
