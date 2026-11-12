/**
 * GH-1226 (S2): the height-blend FIELD, baked from the smooth drawn ground. Headless (three-free), presentation only, nothing in
 * the sim reads it, and nothing here is wired into the renderer yet (S5). The texture wrapper is `height-blend-texture.ts`, the
 * one sibling that imports three, so the `@lions/render/terrain` barrel (and the app's census) stays three-free.
 * Design: `docs/superpowers/specs/2026-11-12-gh1226-height-blend-design.md`, section 3.1.
 *
 * One RGBA8 texel per quarter tile, row-major with z as rows (the control maps' layout), sampled at the texel's CENTRE
 * `((i + 0.5) / 4, (j + 0.5) / 4)` in world tiles, from the Catmull-Rom surface (`smoothLevel`, `smoothNormal`), never a tile corner:
 *  - R, the slope: `round(min(1, theta / 64) x 255)`, theta = `acos(normal.y)` in degrees, a quarter degree a step; 0 on a terrace tile.
 *  - G, the TPI: `smoothLevel` minus its mean over a 13 x 13 texel box (1.5 tiles, edge-clamped), as `round(128 + 127 clamp(tpi, -1, 1))`:
 *    the macro field's own code, so a flat map reads 128, which `macroDecode` turns into exactly 0. It reads `smoothLevel`, not
 *    `surfaceLevel`: the terraces in the latter make open ground at a cliff foot read as a hollow (`tel_marum_2`: 22.8% against 4.1%).
 *  - B, the patch noise: `fbm2` at a 3-tile period, 2 octaves, seed 1226, mapped (v + 1) / 2 to 0..255.
 *  - A: 255, reserved.
 *
 * The field is whole-map and never per chunk. It is indexed by `worldXZ / mapSize`, so every chunk samples the same texel at a
 * shared edge.
 *
 * THE SPLICE. A building collapse changes the terrace set, and with it the smoothing source, around its footprint. Levels and
 * slope change within `HEIGHT_BLEND_FIELD_LEVEL_MARGIN_TILES` (2: the surface reads field columns x-2..x+2) of a changed tile; the
 * TPI changes a further `HEIGHT_BLEND_FIELD_BOX_RADIUS_TEXELS` (6 texels, the box radius) beyond that. A full bake IS a splice whose
 * changed rectangle is the whole map, and the box mean is a direct 13-tap sum in a fixed order (no running sum), so the splice is
 * byte-identical to a full bake by construction, not by luck (`packages/app/src/height-blend-field.test.ts` walks real collapses).
 *
 * Constants: S1 (`height-blend.ts`) carries the same numbers under its own names; they must be equal, and a test that pins both by
 * literal comes when both are on main. The names here are prefixed so the two modules can share a barrel without a collision.
 */
import { latticeValue } from './noise';
import { type TerrainSurface } from './surface';
import { WORLD_PER_LEVEL } from './shared';

/** The marker of the module (the bundle pin L1 in the design, section 3.6, looks for it in the main and ThreeRenderer chunks). Must equal nothing else. */
export const HEIGHT_BLEND_FIELD_MARKER = 'rl-height-blend-field';

/** Field texels a tile, per axis. Equals S1's `HEIGHT_FIELD_TEXELS_PER_TILE`. */
export const HEIGHT_BLEND_FIELD_TEXELS_PER_TILE = 4;
/** The TPI's box, in texels (1.5 tiles, odd). Equals S1's `TPI_BOX_TEXELS`. */
export const HEIGHT_BLEND_FIELD_BOX_TEXELS = 13;
/** Degrees at byte 255. Equals S1's `SLOPE_BYTE_RANGE_DEG`. */
export const HEIGHT_BLEND_FIELD_SLOPE_RANGE_DEG = 64;
/** The patch noise. Equal S1's `HEIGHT_BLEND_PATCH_SEED`, `PATCH_PERIOD_TILES` and `PATCH_OCTAVES`. */
export const HEIGHT_BLEND_FIELD_PATCH_SEED = 1226;
export const HEIGHT_BLEND_FIELD_PATCH_PERIOD_TILES = 3;
export const HEIGHT_BLEND_FIELD_PATCH_OCTAVES = 2;

/** The box radius in texels: 6. */
export const HEIGHT_BLEND_FIELD_BOX_RADIUS_TEXELS = (HEIGHT_BLEND_FIELD_BOX_TEXELS - 1) / 2;
/** How far, in tiles, a changed smoothing-source tile reaches into the surface's level and slope (the Catmull-Rom support). */
export const HEIGHT_BLEND_FIELD_LEVEL_MARGIN_TILES = 2;

/** The neutral bytes of a flat map: slope 0, TPI 0. */
export const HEIGHT_BLEND_FIELD_NEUTRAL_R = 0;
export const HEIGHT_BLEND_FIELD_NEUTRAL_G = 128;

export interface HeightBlendFieldData {
  /** `HEIGHT_BLEND_FIELD_MARKER`, stamped by the bake so the string travels with the code (the bundle pin looks for it). */
  readonly marker: string;
  /** Tiles. */
  readonly tilesW: number;
  readonly tilesH: number;
  /** Texels: `tilesW x 4` by `tilesH x 4`. */
  readonly width: number;
  readonly height: number;
  /** RGBA8, `width x height x 4`. */
  readonly data: Uint8Array;
  /** What the bake was made from, kept for the splice's diff and its caches (not part of the texture). */
  readonly source: {
    readonly flat: boolean;
    terrace: Uint8Array;
    field: Float32Array;
    /** The smooth level at every texel centre, and the box mean's horizontal pass. */
    readonly levels: Float64Array;
    readonly hpass: Float64Array;
  };
}

const N = HEIGHT_BLEND_FIELD_TEXELS_PER_TILE;
const R = HEIGHT_BLEND_FIELD_BOX_RADIUS_TEXELS;

/** `noise.ts`'s quintic fade (private there); `patchNoise` must stay bit-equal to `fbm2`, which the render spec pins on a grid of points. */
function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/**
 * `fbm2(x, z, 3, 2, 1226)` to the bit, with the lattice hashes read from a table instead of rehashed four times a texel an octave
 * (the bake's cost on a 96x96 map was a third noise). The table covers the map plus one cell.
 */
export function patchNoise(tilesW: number, tilesH: number): (x: number, z: number) => number {
  const octaves: Array<{ freq: number; seed: number; w: number; table: Float64Array }> = [];
  let frequency = 1 / HEIGHT_BLEND_FIELD_PATCH_PERIOD_TILES;
  for (let o = 0; o < HEIGHT_BLEND_FIELD_PATCH_OCTAVES; o++) {
    const seed = HEIGHT_BLEND_FIELD_PATCH_SEED + o;
    const w = Math.ceil(tilesW * frequency) + 2;
    const h = Math.ceil(tilesH * frequency) + 2;
    const table = new Float64Array(w * h);
    for (let iz = 0; iz < h; iz++) for (let ix = 0; ix < w; ix++) table[iz * w + ix] = latticeValue(ix, iz, seed);
    octaves.push({ freq: frequency, seed, w, table });
    frequency *= 2;
  }
  return (x, z) => {
    let sum = 0;
    let amplitudeSum = 0;
    let amplitude = 1;
    for (const oct of octaves) {
      const sx = x * oct.freq;
      const sz = z * oct.freq;
      const ix = Math.floor(sx);
      const iz = Math.floor(sz);
      const tx = fade(sx - ix);
      const tz = fade(sz - iz);
      const t = oct.table;
      const k = iz * oct.w + ix;
      const v00 = t[k];
      const v10 = t[k + 1];
      const v01 = t[k + oct.w];
      const v11 = t[k + oct.w + 1];
      const vx0 = v00 + (v10 - v00) * tx;
      const vx1 = v01 + (v11 - v01) * tx;
      sum += amplitude * (vx0 + (vx1 - vx0) * tz);
      amplitudeSum += amplitude;
      amplitude *= 0.5;
    }
    return amplitudeSum > 0 ? sum / amplitudeSum : 0;
  };
}

function clampInt(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

// -- The level and the slope in one pass --------------------------------------------------------------------------------------
// `smoothLevel` and `smoothNormal` (surface.ts) each load the same 4 x 4 samples, and `smoothNormal` allocates two arrays and a
// tuple a call: 14 of the 29 ms a 96x96 bake took. `levelAndNormalY` restates BOTH with the same arithmetic in the same order,
// so it is bit-equal to them (pinned on a grid of points in the render spec); the private Catmull-Rom helpers are copied, not
// exported, so surface.ts is untouched.

function catmull(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const a = -p0 + p2;
  const b = 2 * p0 - 5 * p1 + 4 * p2 - p3;
  const c = -p0 + 3 * p1 - 3 * p2 + p3;
  return 0.5 * (2 * p1 + a * t + b * t * t + c * t * t * t);
}
function catmullSlope(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const a = -p0 + p2;
  const b = 2 * p0 - 5 * p1 + 4 * p2 - p3;
  const c = -p0 + 3 * p1 - 3 * p2 + p3;
  return 0.5 * (a + 2 * b * t + 3 * c * t * t);
}

const rows = new Float64Array(4);
const rowSlopes = new Float64Array(4);
const sample = { level: 0, ny: 1 };

/**
 * `smoothLevel(surface, x, z)` and `smoothNormal(surface, x, z)[1]` of a RELIEF surface (NaN on a flat one, whose field is empty).
 * Exported for the spec only: it returns a SHARED mutable sample, overwritten by the next call, so copy what you keep.
 */
export function levelAndNormalY(s: TerrainSurface, x: number, z: number): { level: number; ny: number } {
  const u = x - 0.5;
  const v = z - 0.5;
  const i = Math.floor(u);
  const j = Math.floor(v);
  const tu = u - i;
  const tv = v - j;
  const w = s.width;
  const maxX = w - 1;
  const maxY = s.height - 1;
  for (let k = 0; k < 4; k++) {
    const row = clampInt(j - 1 + k, 0, maxY) * w;
    const p0 = s.field[row + clampInt(i - 1, 0, maxX)];
    const p1 = s.field[row + clampInt(i, 0, maxX)];
    const p2 = s.field[row + clampInt(i + 1, 0, maxX)];
    const p3 = s.field[row + clampInt(i + 2, 0, maxX)];
    rows[k] = catmull(p0, p1, p2, p3, tu);
    rowSlopes[k] = catmullSlope(p0, p1, p2, p3, tu);
  }
  sample.level = catmull(rows[0], rows[1], rows[2], rows[3], tv);
  const dLdx = catmull(rowSlopes[0], rowSlopes[1], rowSlopes[2], rowSlopes[3], tv);
  const dLdz = catmullSlope(rows[0], rows[1], rows[2], rows[3], tv);
  const nx = -dLdx * WORLD_PER_LEVEL;
  const nz = -dLdz * WORLD_PER_LEVEL;
  sample.ny = 1 / Math.hypot(nx, 1, nz);
  return sample;
}

/** One texel's R and B, and (relief only) its level, at texel `(i, j)`. */
function bakeLevelTexel(f: HeightBlendFieldData, surface: TerrainSurface, noiseAt: (x: number, z: number) => number, i: number, j: number): void {
  const x = (i + 0.5) / N;
  const z = (j + 0.5) / N;
  const o = (j * f.width + i) * 4;
  let slope = 0;
  if (!surface.flat) {
    levelAndNormalY(surface, x, z);
    f.source.levels[j * f.width + i] = sample.level;
    const tile = Math.floor(z) * f.tilesW + Math.floor(x);
    if (surface.terrace[tile] === 0) {
      const theta = (Math.acos(sample.ny) * 180) / Math.PI;
      // Clamped: a Uint8Array store wraps (66 degrees would read byte 7, nearly flat).
      slope = Math.round(Math.min(1, theta / HEIGHT_BLEND_FIELD_SLOPE_RANGE_DEG) * 255);
    }
  }
  f.data[o] = slope;
  const noise = noiseAt(x, z);
  f.data[o + 2] = clampInt(Math.round((noise * 0.5 + 0.5) * 255), 0, 255);
  f.data[o + 3] = 255;
}

/**
 * Rebakes everything that depends on the changed tile rectangle `[tx0, tx1] x [ty0, ty1]` (inclusive): levels, slope and noise
 * within `levelMargin` tiles of it, the box mean's horizontal pass over those rows, and the TPI over the result grown by the box
 * radius. Returns the texels whose G it wrote.
 */
function refresh(
  f: HeightBlendFieldData,
  surface: TerrainSurface,
  tx0: number,
  ty0: number,
  tx1: number,
  ty1: number,
  levelMargin: number,
  boxRadius: number
): number {
  const lx0 = Math.max(0, (tx0 - levelMargin) * N);
  const ly0 = Math.max(0, (ty0 - levelMargin) * N);
  const lx1 = Math.min(f.width, (tx1 + 1 + levelMargin) * N);
  const ly1 = Math.min(f.height, (ty1 + 1 + levelMargin) * N);
  const noiseAt = patchNoise(f.tilesW, f.tilesH);
  for (let j = ly0; j < ly1; j++) for (let i = lx0; i < lx1; i++) bakeLevelTexel(f, surface, noiseAt, i, j);
  const ox0 = Math.max(0, lx0 - boxRadius);
  const oy0 = Math.max(0, ly0 - boxRadius);
  const ox1 = Math.min(f.width, lx1 + boxRadius);
  const oy1 = Math.min(f.height, ly1 + boxRadius);
  const { levels, hpass } = f.source;
  if (surface.flat) {
    for (let j = oy0; j < oy1; j++) for (let i = ox0; i < ox1; i++) f.data[(j * f.width + i) * 4 + 1] = HEIGHT_BLEND_FIELD_NEUTRAL_G;
    return (ox1 - ox0) * (oy1 - oy0);
  }
  const w = f.width;
  const taps = 2 * boxRadius + 1;
  // Horizontal pass: only the rows whose levels changed, over the columns the output reads. A fixed-order direct sum.
  for (let j = ly0; j < ly1; j++) {
    for (let i = ox0; i < ox1; i++) {
      let sum = 0;
      const row = j * w;
      if (i - boxRadius >= 0 && i + boxRadius < w) for (let k = i - boxRadius; k <= i + boxRadius; k++) sum += levels[row + k];
      else for (let k = -boxRadius; k <= boxRadius; k++) sum += levels[row + clampInt(i + k, 0, w - 1)];
      hpass[row + i] = sum / taps;
    }
  }
  for (let j = oy0; j < oy1; j++) {
    for (let i = ox0; i < ox1; i++) {
      let sum = 0;
      if (j - boxRadius >= 0 && j + boxRadius < f.height) for (let k = j - boxRadius; k <= j + boxRadius; k++) sum += hpass[k * w + i];
      else for (let k = -boxRadius; k <= boxRadius; k++) sum += hpass[clampInt(j + k, 0, f.height - 1) * w + i];
      const tpi = levels[j * w + i] - sum / taps;
      f.data[(j * w + i) * 4 + 1] = Math.round(128 + 127 * Math.max(-1, Math.min(1, tpi)));
    }
  }
  return (ox1 - ox0) * (oy1 - oy0);
}

/** The whole-map bake. */
export function bakeHeightBlendField(surface: TerrainSurface, tilesW: number, tilesH: number): HeightBlendFieldData {
  if (tilesW !== surface.width || tilesH !== surface.height) {
    throw new Error(`bakeHeightBlendField: ${tilesW}x${tilesH} tiles asked of a ${surface.width}x${surface.height} surface`);
  }
  const width = tilesW * N;
  const height = tilesH * N;
  const f: HeightBlendFieldData = {
    marker: HEIGHT_BLEND_FIELD_MARKER,
    tilesW,
    tilesH,
    width,
    height,
    data: new Uint8Array(width * height * 4),
    source: {
      flat: surface.flat,
      terrace: surface.terrace.slice(),
      field: surface.field.slice(),
      levels: new Float64Array(surface.flat ? 0 : width * height),
      hpass: new Float64Array(surface.flat ? 0 : width * height),
    },
  };
  refresh(f, surface, 0, 0, tilesW - 1, tilesH - 1, 0, R);
  return f;
}

/**
 * Re-bakes, in place, what a changed `surface` (the same map after a collapse) moved, and returns the number of texels whose TPI it
 * rewrote; the field ends byte-identical to `bakeHeightBlendField(surface, ...)`. Returns `null` when the two cannot be compared
 * (a different size or flatness): the caller bakes whole. The changed tiles are found by diffing the smoothing source and the
 * terrace flag against the copies the field kept.
 */
export function spliceHeightBlendField(
  f: HeightBlendFieldData,
  surface: TerrainSurface,
  levelMarginTiles: number = HEIGHT_BLEND_FIELD_LEVEL_MARGIN_TILES,
  boxRadiusTexels: number = R
): number | null {
  if (surface.flat !== f.source.flat) return null;
  if (surface.flat) return 0;
  if (surface.field.length !== f.source.field.length) return null;
  let tx0 = f.tilesW;
  let ty0 = f.tilesH;
  let tx1 = -1;
  let ty1 = -1;
  for (let t = 0; t < surface.field.length; t++) {
    if (surface.field[t] === f.source.field[t] && surface.terrace[t] === f.source.terrace[t]) continue;
    const x = t % f.tilesW;
    const y = (t - x) / f.tilesW;
    if (x < tx0) tx0 = x;
    if (x > tx1) tx1 = x;
    if (y < ty0) ty0 = y;
    if (y > ty1) ty1 = y;
  }
  if (tx1 < 0) return 0;
  const written = refresh(f, surface, tx0, ty0, tx1, ty1, levelMarginTiles, boxRadiusTexels);
  f.source.field = surface.field.slice();
  f.source.terrace = surface.terrace.slice();
  return written;
}
