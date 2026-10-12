import { describe, it, expect } from 'vitest';
import { pruneHiddenHostiles, type SeatSight } from './hidden-selection';

/** Units 0-1 on side 0, 2-3 on side 1, 4 a civilian (side 2); unit i stands
 *  at tile (i, 0). `seen` is the set of tiles in sight. */
function sight(viewer: number, seen: number[]): SeatSight {
  const side = [0, 0, 1, 1, 2];
  return {
    viewer,
    sideOf: (i) => side[i],
    posOf: (i) => ({ x: i + 0.5, y: 0.5 }),
    fogVisible: (wx) => seen.includes(Math.floor(wx)),
  };
}

describe('pruneHiddenHostiles (N1a final review)', () => {
  it('drops a selected hostile the fog now hides', () => {
    expect(pruneHiddenHostiles([2], sight(0, []))).toEqual([]);
  });
  it('keeps a hostile still in sight, returning the same array', () => {
    const sel = [2, 3];
    expect(pruneHiddenHostiles(sel, sight(0, [2, 3]))).toBe(sel);
  });
  it('keeps the seat\'s own units through fog', () => {
    const sel = [0, 1];
    expect(pruneHiddenHostiles(sel, sight(0, []))).toBe(sel);
  });
  it('drops only the hidden ones from a mixed selection, in order', () => {
    expect(pruneHiddenHostiles([0, 2, 3, 4], sight(0, [3]))).toEqual([0, 3]);
  });
  it('treats a fogged civilian as hidden, as the renderer does', () => {
    expect(pruneHiddenHostiles([4], sight(0, []))).toEqual([]);
  });
  it('is the mirror for the seat on side 1', () => {
    expect(pruneHiddenHostiles([0, 2], sight(1, []))).toEqual([2]);
  });
});
