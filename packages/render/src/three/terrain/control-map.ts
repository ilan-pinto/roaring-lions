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
import { DECOR_GROVE, DECOR_KNOLL, DECOR_RIDGE, DECOR_ROAD, hexToLinear } from './shared';
import { SCRUB_TIER_STRENGTH } from './ground';
import { boxBlur, fbm2, valueNoise2 } from './noise';
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

/**
 * Task 4b: the height bias and the macro field -- appended to this same file
 * rather than a sibling module, purely because the controller's file-size cap
 * split Task 4 in two, not because the two halves are independent ideas. Both
 * still feed the same fragment shader `control-map.ts`'s A/B textures do.
 */

/** How strongly a tile's OWN blend weight is pulled toward 1 (and its
 *  neighbours' pulled toward 0) by a favourable relative height, at the
 *  midpoint of the blend (`w = 0.5`) where the pull is strongest. Zero at
 *  `w = 0` and `w = 1`: a tile that already owns the whole texel, or none of
 *  it, has nothing left to gain from height. */
export const HEIGHT_BLEND = 0.15;

/**
 * Biases a set of blend weights `w` toward whichever channel sits on higher
 * relative ground `h` (its own sign carries the direction; magnitude does not
 * need to be normalised, since the whole expression is rescaled afterward),
 * without inventing or destroying weight overall.
 *
 * `w_i' = max(0, w_i + HEIGHT_BLEND * h_i * 4 * w_i * (1 - w_i))`, then every
 * entry is scaled so `sum(w') = sum(w)`. The `4 * w_i * (1 - w_i)` factor is
 * a parabola that is exactly 0 at `w_i = 0` and `w_i = 1` and peaks at 1
 * when `w_i = 0.5` -- so a tile interior, where one weight is already 1 and
 * the rest 0, is untouched (every factor is 0 there), and the bias only ever
 * acts inside an edge blend, where it is needed. `max(0, ...)` guards a
 * weight from going negative when its height is unfavourable; the rescale
 * afterward is what makes that guard meaningful rather than just shrinking
 * the total. Falls back to `w` itself, unchanged, on the degenerate case
 * where every biased weight collapsed to 0 (only possible if every input
 * weight was already 0).
 */
export function heightBiased(w: readonly number[], h: readonly number[]): number[] {
  const raw = w.map((wi, i) => Math.max(0, wi + HEIGHT_BLEND * h[i] * 4 * wi * (1 - wi)));
  const rawSum = raw.reduce((sum, v) => sum + v, 0);
  if (rawSum === 0) return w.slice();
  const wantSum = w.reduce((sum, v) => sum + v, 0);
  const scale = wantSum / rawSum;
  return raw.map((v) => v * scale);
}

/** Side length, in texels, of the macro field -- fixed regardless of map
 *  size, since the field is stretched to cover the whole map rather than
 *  scaled per-tile the way the control textures above are. */
export const MACRO_SIZE = 256;
/** How many tiles one full noise cycle of the macro field's base octave
 *  spans. */
export const MACRO_PERIOD_TILES = 12;
/** `fbm2` octave count for the macro field. */
export const MACRO_OCTAVES = 3;
/** Box-blur radius for the macro field, in TILES -- converted to texels by
 *  `macroBlurTexels` for a given map width. Also doubles, deliberately, as
 *  the width of the border band the field is faded to neutral across (F-13):
 *  reusing the one number rather than adding a second keeps the fade band
 *  and the blur radius from ever drifting apart, and there is no
 *  design reason for them to differ -- both exist to keep the field smooth
 *  at the scale a `fbm2` sample can actually resolve. */
export const MACRO_BLUR_TILES = 1.5;
/** Maximum luminance swing the macro field can apply, at `m = +/-1` and
 *  amplitude 1 -- see `macroFactor`. */
export const MACRO_LUMINANCE = 0.07;
/** Maximum hue-mix weight the macro field can apply toward its bright/dark
 *  tint, at `|m| = 1` and amplitude 1 -- see `macroFactor`. */
export const MACRO_HUE = 0.04;

export interface MacroField {
  readonly size: number;
  /** `size * size` bytes, row-major, one per texel: 128 is neutral (`m = 0`),
   *  0 is the darkest extreme (`m = -1`) and 255 the brightest (`m = 1`). */
  readonly data: Uint8Array;
}

/** How many texels of the fixed `MACRO_SIZE` grid `MACRO_BLUR_TILES` tiles
 *  work out to on a map `mapWidth` tiles wide -- the field is stretched over
 *  the whole map, so a tile is worth fewer texels on a wider map. Takes only
 *  the width (not height) because `boxBlur`'s radius is a single number
 *  shared by both passes; on a non-square map this makes the blur (and the
 *  border fade that reuses it) span `MACRO_BLUR_TILES` tiles along X and a
 *  proportionally different tile count along Z, which is an accepted
 *  approximation rather than a bug -- nothing this task's tests measure
 *  depends on the two axes agreeing on a non-square map. */
export function macroBlurTexels(mapWidth: number): number {
  return Math.round((MACRO_BLUR_TILES * MACRO_SIZE) / mapWidth);
}

/** Linear fade-to-neutral weight for texel `(i, j)` in a `size x size` grid,
 *  0 at the outermost texel and reaching 1 by `band` texels in from every
 *  edge. `band <= 0` never fades. F-13: without this, a macro luminance step
 *  of up to `2 * MACRO_LUMINANCE` (7%) can land exactly on the map's own
 *  edge and outline it against the skirt beyond, which never sees the field
 *  at all. */
function borderFade(i: number, j: number, size: number, band: number): number {
  if (band <= 0) return 1;
  const edge = Math.min(i, size - 1 - i, j, size - 1 - j);
  return Math.min(1, Math.max(0, edge / band));
}

/**
 * Builds the macro field: a single low-frequency scalar over the WHOLE map
 * (not per-tile like the control textures above), sampled once per texel of
 * a fixed `MACRO_SIZE x MACRO_SIZE` grid stretched across `mapWidth x
 * mapHeight` tiles.
 *
 *  1. Each texel centre maps to a world tile position and samples
 *     `fbm2(..., MACRO_PERIOD_TILES, MACRO_OCTAVES, 404)`.
 *  2. The raw field is box-blurred by `macroBlurTexels(mapWidth)`.
 *  3. The blurred field is normalised by its own `max|v|` (not by separate
 *     min/max, which would move neutral off `m = 0` and bias the ground's
 *     overall tone -- F-2) to bytes `round(128 + 127 * v)`, THEN faded to
 *     neutral over the outer `MACRO_BLUR_TILES` tiles of texels (F-13) --
 *     applied last so the fade cannot itself skew the normalisation.
 */
export function buildMacroField(mapWidth: number, mapHeight: number): MacroField {
  const size = MACRO_SIZE;
  const raw = new Float32Array(size * size);
  for (let j = 0; j < size; j++) {
    const pz = ((j + 0.5) / size) * mapHeight;
    for (let i = 0; i < size; i++) {
      const px = ((i + 0.5) / size) * mapWidth;
      raw[j * size + i] = fbm2(px, pz, MACRO_PERIOD_TILES, MACRO_OCTAVES, 404);
    }
  }

  const blurred = boxBlur(raw, size, size, macroBlurTexels(mapWidth));

  let maxAbs = 0;
  for (const v of blurred) maxAbs = Math.max(maxAbs, Math.abs(v));
  const norm = maxAbs > 0 ? 1 / maxAbs : 0;

  const band = macroBlurTexels(mapWidth);
  const data = new Uint8Array(size * size);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const v = blurred[j * size + i] * norm * borderFade(i, j, size, band);
      data[j * size + i] = Math.min(255, Math.max(0, Math.round(128 + 127 * v)));
    }
  }
  return { size, data };
}

/**
 * `hex`'s linear-space colour, rescaled so its own Rec. 709 luminance
 * (`0.2126 R + 0.7152 G + 0.0722 B`) is exactly 1. `macroFactor` mixes toward
 * this rather than toward the raw palette colour so that the macro field
 * changes HUE without also changing the luminance `MACRO_LUMINANCE` already
 * controls on its own -- mixing toward an un-normalised swatch would double
 * up the two effects and make `MACRO_LUMINANCE` a lie for any tint whose own
 * luminance is not 1.
 */
export function neutralTint(hex: string): [number, number, number] {
  const [r, g, b] = hexToLinear(hex);
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return [r / lum, g / lum, b / lum];
}

/**
 * The per-channel multiplier the macro field applies to the ground's albedo
 * at a texel where the field reads `m` (in `[-1, 1]`, `0` neutral) and the
 * effect's own amplitude is `amp` (so a caller can fade the whole effect in
 * or out, e.g. by distance or by theme, without touching `m` itself):
 *
 * `(1 + MACRO_LUMINANCE * m * amp) * mix(1, m >= 0 ? bright : dark, MACRO_HUE * |m| * amp)`
 *
 * -- a luminance term (brighter when `m > 0`, darker when `m < 0`) times a
 * hue term that mixes from neutral (1) toward `bright` or `dark` (both
 * `neutralTint`-normalised, so this mix cannot itself move luminance) by a
 * weight that grows with `|m|`. Neutral (`[1, 1, 1]`) whenever `m = 0` or
 * `amp = 0`, regardless of `bright`/`dark`.
 */
export function macroFactor(
  m: number,
  amp: number,
  bright: readonly number[],
  dark: readonly number[]
): [number, number, number] {
  const luminance = 1 + MACRO_LUMINANCE * m * amp;
  const hueWeight = MACRO_HUE * Math.abs(m) * amp;
  const tint = m >= 0 ? bright : dark;
  return [0, 1, 2].map((c) => luminance * (1 + hueWeight * (tint[c] - 1))) as [number, number, number];
}
