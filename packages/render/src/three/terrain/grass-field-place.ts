/**
 * GH-1167 S1: where the 3D grass clumps stand. Headless (no three.js), presentation only, deterministic from the map.
 *
 * Design: `docs/superpowers/specs/2026-11-11-wadi-halam-3d-grass-design.md` §2.1 (placement) and §3.1.
 *
 *  - Candidates: a jittered 5x5 grid per tile (25), the jitter +/-0.4 of a cell (13 Nov: was 4x4; 16 candidates cannot reach 12
 *    clumps a tile at `SCATTER_DENSITY` 0.75 without a keep of 1 everywhere, which would flatten the patch field).
 *  - Kept when `hash < (KEEP_FLOOR + KEEP_SPAN * patch) * density`, where `patch` is a low-frequency value-noise field
 *    (5-tile wavelength) in [0, 1]: meadow patches and bare stony gaps, not a lawn. At density 1 the mean keep is 0.64
 *    (16 clumps a tile); at the shipped `SCATTER_DENSITY` 0.75 it is 12 (lead ruling 13 Nov; was 8.4). The dial scales the seed probability only,
 *    never a clump's look (spec §8, N-22).
 *  - Open ground only: the same test as the scatter, `isOpenScatterAt`, applied per clump (no road clearance, cover,
 *    grove, boulder, building or water).
 *  - Randomness is `tileHash` streams on offsets no other family reads (every other stream stays under 1,000 on both
 *    axes; these start at 100,003), plus `valueNoise2` for the patch field. Never `Math.random`, never a global stream.
 *  - Output is a struct of arrays, sorted back to front for the fixed camera (the camera never turns, so the order is
 *    static, spec §3.3).
 *
 * Imports nothing from the sim, not even a type.
 */
import { tileHash } from '../../tile-hash';
import { valueNoise2 } from './noise';
import { cachedRoadGraph, isOpenScatterAt, SCATTER_DENSITY } from './decor-place';
import { surfaceWorldY, type TerrainSurface } from './surface';
import type { RoadGraph } from './road-graph';
import type { TerrainInput } from './types';

/** A tile's candidate grid is `GRASS_GRID` x `GRASS_GRID`. */
export const GRASS_GRID = 5;
export const GRASS_CANDIDATES_PER_TILE = GRASS_GRID * GRASS_GRID;
/** The jitter of a candidate, in cells, either way. */
export const GRASS_JITTER_CELLS = 0.4;
/** Keep probability is `(GRASS_KEEP_FLOOR + GRASS_KEEP_SPAN * patch) * density`; its mean at patch 0.5 is 0.64. */
export const GRASS_KEEP_FLOOR = 0.34;
export const GRASS_KEEP_SPAN = 0.6;
/** The patch field's wavelength in tiles, and its seed (the issue number). */
export const GRASS_PATCH_WAVELENGTH_TILES = 5;
export const GRASS_PATCH_SEED = 1167;
/** A clump's scale is `GRASS_CLUMP_SCALE_MIN + GRASS_CLUMP_SCALE_SPAN * roll`: 0.85 to 1.15. */
export const GRASS_CLUMP_SCALE_MIN = 0.85;
export const GRASS_CLUMP_SCALE_SPAN = 0.3;
/** Three clump variants (12, 16 and 20 blades, S2). */
export const GRASS_VARIANTS = 3;

// Stream offsets. One (x, y) pair per roll; x carries the candidate index, so a candidate's rolls are independent.
const X_BASE = 100003;
const Y_KEEP = 200003;
const Y_JX = 300007;
const Y_JZ = 400009;
const Y_YAW = 500009;
const Y_SCALE = 600011;
const Y_VARIANT = 700001;
const Y_THIN = 800003;

/** Camera constants for the back-to-front key. The camera is fixed at a 45 degree azimuth and a 30 degree elevation
 *  (`camera.ts`); it sits on the +x, +z side, so a larger `x + z` is nearer. */
const COS_EL_AZ = Math.cos(Math.PI / 6) * Math.SQRT1_2;
const SIN_EL = Math.sin(Math.PI / 6);

/** The clumps, as a struct of arrays in back-to-front order. x and z are in tiles; y is the drawn ground height. */
export interface GrassClumps {
  readonly count: number;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly z: Float32Array;
  /** Turns, [0, 1). */
  readonly yaw: Float32Array;
  readonly scale: Float32Array;
  /** 0 to `GRASS_VARIANTS - 1`. */
  readonly variant: Uint8Array;
}

/** The patch field at world `(px, pz)`, in [0, 1]. */
export function grassPatchAt(px: number, pz: number): number {
  const n = valueNoise2(px, pz, 1 / GRASS_PATCH_WAVELENGTH_TILES, GRASS_PATCH_SEED);
  return Math.min(1, Math.max(0, (n + 1) / 2));
}

/** One clump before it is sorted. */
export interface GrassClump {
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
  readonly scale: number;
  readonly variant: number;
  /** A stable roll in [0, 1): the zoom rung (`grass-field-cells.ts`) keeps the clumps whose roll is under its keep fraction. */
  readonly thin: number;
}

/**
 * The clumps tile `(tx, ty)` owns, in candidate order. `graph` is the map's road graph. A clump belongs to its SOURCE
 * tile; the open test reads the tile it lands on (at most 0.1 tile from the source's edge), so a collapse that changes
 * `blocked` re-places the tile and its eight neighbours.
 */
export function grassClumpsOfTile(
  input: TerrainInput,
  graph: RoadGraph,
  tx: number,
  ty: number,
  density: number,
  out: GrassClump[]
): void {
  const jitter = (GRASS_JITTER_CELLS * 2) / GRASS_GRID;
  for (let k = 0; k < GRASS_CANDIDATES_PER_TILE; k++) {
    const sx = tx * GRASS_CANDIDATES_PER_TILE + k + X_BASE;
    const ci = k % GRASS_GRID;
    const cj = Math.floor(k / GRASS_GRID);
    const px = tx + (ci + 0.5) / GRASS_GRID + (tileHash(sx, ty + Y_JX) - 0.5) * jitter;
    const pz = ty + (cj + 0.5) / GRASS_GRID + (tileHash(sx, ty + Y_JZ) - 0.5) * jitter;
    const keep = (GRASS_KEEP_FLOOR + GRASS_KEEP_SPAN * grassPatchAt(px, pz)) * density;
    if (tileHash(sx, ty + Y_KEEP) >= keep) continue;
    if (!isOpenScatterAt(input, graph, px, pz)) continue;
    out.push({
      x: px,
      z: pz,
      yaw: tileHash(sx, ty + Y_YAW),
      scale: GRASS_CLUMP_SCALE_MIN + GRASS_CLUMP_SCALE_SPAN * tileHash(sx, ty + Y_SCALE),
      variant: Math.min(GRASS_VARIANTS - 1, Math.floor(tileHash(sx, ty + Y_VARIANT) * GRASS_VARIANTS)),
      thin: tileHash(sx, ty + Y_THIN),
    });
  }
}

/** Distance along the view axis, smaller is farther from the camera. The ground height is part of it: a raised
 *  clump is nearer the lens than a low one at the same `x + z`. */
export function grassDepthKey(x: number, y: number, z: number): number {
  return (x + z) * COS_EL_AZ + y * SIN_EL;
}

/** Every clump on the map, back to front. `surface` seats each on the drawn ground (`surfaceWorldY`). */
export function placeGrassClumps(
  input: TerrainInput,
  surface: TerrainSurface,
  density: number = SCATTER_DENSITY
): GrassClumps {
  const graph = cachedRoadGraph(input);
  const list: GrassClump[] = [];
  for (let ty = 0; ty < input.height; ty++) {
    for (let tx = 0; tx < input.width; tx++) {
      const t = ty * input.width + tx;
      // A tile that is not open ground itself can still own a clump (the candidate jitters at most 0.1 tile), but the
      // landing test refuses it; skipping a closed tile outright is the same answer for free.
      if (input.blocked[t] !== 0 || input.cover[t] !== 0) continue;
      grassClumpsOfTile(input, graph, tx, ty, density, list);
    }
  }
  const n = list.length;
  const ys = new Float64Array(n);
  const keys = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    ys[i] = surfaceWorldY(surface, list[i].x, list[i].z);
    keys[i] = grassDepthKey(list[i].x, ys[i], list[i].z);
  }
  // Ascending key is back to front. Ties break on z, then x, so the order is total and the same on every engine.
  const order = Array.from({ length: n }, (_, i) => i).sort(
    (a, b) => keys[a] - keys[b] || list[a].z - list[b].z || list[a].x - list[b].x
  );
  const out: GrassClumps = {
    count: n,
    x: new Float32Array(n),
    y: new Float32Array(n),
    z: new Float32Array(n),
    yaw: new Float32Array(n),
    scale: new Float32Array(n),
    variant: new Uint8Array(n),
  };
  for (let i = 0; i < n; i++) {
    const c = list[order[i]];
    out.x[i] = c.x;
    out.y[i] = ys[order[i]];
    out.z[i] = c.z;
    out.yaw[i] = c.yaw;
    out.scale[i] = c.scale;
    out.variant[i] = c.variant;
  }
  return out;
}
