/**
 * The ground's grain is deterministic: the same tile scatters the same way
 * every run, in both backends. That is the whole point of a hash here rather
 * than a PRNG -- terrain is rebuilt whenever it goes dirty, and a stream would
 * give a different map each time.
 *
 * These values were captured from PixiRenderer.h2 before it was extracted. If
 * they change, three.js terrain stops landing where Pixi's does.
 */
import { describe, it, expect } from 'vitest';
import { tileHash } from './tile-hash';

describe('tileHash', () => {
  it('is stable for known tiles', () => {
    expect(tileHash(0, 0)).toBeCloseTo(0, 12);
    expect(tileHash(7, 13)).toBeCloseTo(0.18202890572138131, 12);
    expect(tileHash(47, 47)).toBeCloseTo(0.090054566971957684, 12);
  });

  it('stays inside 0..1', () => {
    for (let x = 0; x < 64; x++) {
      for (let y = 0; y < 64; y++) {
        const h = tileHash(x, y);
        expect(h).toBeGreaterThanOrEqual(0);
        expect(h).toBeLessThan(1);
      }
    }
  });

  it('differs between neighbouring tiles', () => {
    // A hash that returned a smooth function of x and y would pass the range
    // check above while making every tile look like its neighbour.
    expect(tileHash(4, 4)).not.toBeCloseTo(tileHash(5, 4), 3);
    expect(tileHash(4, 4)).not.toBeCloseTo(tileHash(4, 5), 3);
  });
});
