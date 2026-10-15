// Intel earned by doing (F1, D4): high ground as a pure function of the map.
//
// A "rise" is a 4-connected component of open tiles standing at least
// HIGH_GROUND_LEVELS above the map's median open-tile level. Nothing here reads
// a Sim or a clock; Task 5 hands it `sim.elevation` and `sim.blocked`.
// Integer only: levels are 0-9, so the median is a counting sort.
import { HIGH_GROUND_LEVELS } from './tuning';

const LEVELS = 10;

/** The median elevation of open (unblocked) tiles, lower median on an even count. Integer.
 *  A map with no open tile reads 0. */
export function medianOpenLevel(elevation: Uint8Array, blocked: Uint8Array): number {
  const counts = new Int32Array(LEVELS);
  let n = 0;
  for (let t = 0; t < elevation.length; t++) {
    if (blocked[t] !== 0) continue;
    const level = elevation[t];
    counts[level < LEVELS ? level : LEVELS - 1]++;
    n++;
  }
  if (n === 0) return 0;
  // Zero-based rank of the lower median in the sorted list.
  const rank = (n - 1) >> 1;
  let seen = 0;
  for (let level = 0; level < LEVELS; level++) {
    seen += counts[level];
    if (seen > rank) return level;
  }
  return LEVELS - 1;
}

/** One id per tile (-1 = not high ground): 4-connected components of open tiles at
 *  >= median + HIGH_GROUND_LEVELS. Deterministic order: ids assigned in row-major scan. */
export function highGroundRises(
  elevation: Uint8Array,
  blocked: Uint8Array,
  w: number,
  h: number,
): { riseOf: Int16Array; count: number } {
  const tiles = w * h;
  const riseOf = new Int16Array(tiles).fill(-1);
  const floor = medianOpenLevel(elevation, blocked) + HIGH_GROUND_LEVELS;
  const high = (t: number): boolean => blocked[t] === 0 && elevation[t] >= floor;
  const stack = new Int32Array(tiles);
  let count = 0;
  for (let start = 0; start < tiles; start++) {
    if (riseOf[start] !== -1 || !high(start)) continue;
    const id = count++;
    let top = 0;
    stack[top++] = start;
    riseOf[start] = id;
    while (top > 0) {
      const t = stack[--top];
      const x = t % w;
      if (x > 0 && riseOf[t - 1] === -1 && high(t - 1)) { riseOf[t - 1] = id; stack[top++] = t - 1; }
      if (x < w - 1 && riseOf[t + 1] === -1 && high(t + 1)) { riseOf[t + 1] = id; stack[top++] = t + 1; }
      if (t >= w && riseOf[t - w] === -1 && high(t - w)) { riseOf[t - w] = id; stack[top++] = t - w; }
      if (t + w < tiles && riseOf[t + w] === -1 && high(t + w)) { riseOf[t + w] = id; stack[top++] = t + w; }
    }
  }
  return { riseOf, count };
}
