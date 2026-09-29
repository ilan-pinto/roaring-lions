/**
 * A4 Task 5 (GH-186): the RING_LARGE_TILES tier boundary of the ring-burial sweep, in its own
 * file so it runs in its own worker (see `ring_burial_sweep.ts`).
 */
import { describe, expect, it } from 'vitest';
import { RING_LARGE_TILES } from '../../packages/render/src/three/units/readability';
import { ringGridFor } from '../../packages/render/src/three/units/selection-ring';
import { BURIAL_LIMIT, HEADINGS, RELIEFS, sweep } from './ring_burial_sweep';

describe('the tier boundaries (fix round 3): a ring near a threshold cannot bury', () => {
  // At, just under and just over the RING_LARGE_TILES threshold, on whatever grid it gets.
  // Swept at every heading: a future ellipse near a boundary will turn.
  const STEP = 0.01;
  const cases = [RING_LARGE_TILES - STEP, RING_LARGE_TILES, RING_LARGE_TILES + STEP];

  it.each(cases)('a ring of %s tiles', async (radius) => {
    for (const r of RELIEFS) {
      expect(await sweep(r, r.footSteep, ringGridFor(radius, radius), radius, radius, HEADINGS), r.id).toBeLessThanOrEqual(BURIAL_LIMIT);
    }
  }, 60_000);
});
