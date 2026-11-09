/**
 * Deterministic per-tile hash for ground variation -- same look every run.
 *
 * Extracted from `PixiRenderer.h2` unchanged. It lives here because the three.js
 * backend has to scatter its grain onto the same tiles in the same places: two
 * hashes that merely both look random would put a limestone fleck in a different
 * spot in each backend, and every comparison between them would show noise no
 * one could attribute.
 *
 * The five numbers are exported because the decal shader carries a GLSL copy
 * (`three/decal-pool.ts`, `rlHash`) and builds it from these names rather than
 * from retyped literals that could drift from this function.
 */
import type { IntOps } from './three/fog-ops';

export const TILE_HASH_MX = 374761393;
export const TILE_HASH_MY = 668265263;
export const TILE_HASH_MIX = 1274126177;
/** The two xorshift distances: `h ^ (h >>> 13)`, then `h ^ (h >>> 16)`. */
export const TILE_HASH_SHIFT_A = 13;
export const TILE_HASH_SHIFT_B = 16;

export function tileHash(x: number, y: number): number {
  let h = (x * TILE_HASH_MX + y * TILE_HASH_MY) | 0;
  h = Math.imul(h ^ (h >>> TILE_HASH_SHIFT_A), TILE_HASH_MIX);
  return ((h ^ (h >>> TILE_HASH_SHIFT_B)) >>> 0) / 4294967296;
}

/**
 * GH-943 P2 (T1): `tileHash`'s integer body written once against `IntOps` (`three/fog-ops.ts`), returning the uint32 `h` before
 * the divide; `tileHash(x, y) === tileHashOps(NUMBER_INT_OPS, x, y) / 2^32` wherever `tileHash`'s own double products are exact
 * (|x|, |y| < 2^22). The node twins build the same expression on `uint` nodes (`tslIntOps`), so the wind's gust lattice (T6) is
 * this function and not a third retyping of the GLSL `rlWindHash`.
 */
export function tileHashOps<T>(o: IntOps<T>, x: T, y: T): T {
  let h = o.add(o.imul(o.fromFloat(x), o.lit(TILE_HASH_MX)), o.imul(o.fromFloat(y), o.lit(TILE_HASH_MY)));
  h = o.imul(o.xor(h, o.shr(h, TILE_HASH_SHIFT_A)), o.lit(TILE_HASH_MIX));
  return o.xor(h, o.shr(h, TILE_HASH_SHIFT_B));
}
