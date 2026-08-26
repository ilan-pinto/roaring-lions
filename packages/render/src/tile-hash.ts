/**
 * Deterministic per-tile hash for ground variation -- same look every run.
 *
 * Extracted from `PixiRenderer.h2` unchanged. It lives here because the three.js
 * backend has to scatter its grain onto the same tiles in the same places: two
 * hashes that merely both look random would put a limestone fleck in a different
 * spot in each backend, and every comparison between them would show noise no
 * one could attribute.
 */
export function tileHash(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
