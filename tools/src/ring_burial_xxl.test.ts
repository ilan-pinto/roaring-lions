/**
 * GH-346: the RING_XXL_TILES tier boundary of the ring-burial sweep, in its own
 * file so it runs in its own worker (see `ring_burial_sweep.ts`): a ring just
 * under, at and just over 1.5 tiles, on whatever grid `ringGridFor` gives it.
 */
import { describe, expect, it } from 'vitest';
import { RING_XXL_TILES } from '../../packages/render/src/three/units/readability';
import { ringGridFor } from '../../packages/render/src/three/units/selection-ring';
import { BURIAL_LIMIT, HEADINGS, RELIEFS, sweep } from './ring_burial_sweep';

describe('the 9x9 tier boundary (GH-346): a ring near the threshold cannot bury', () => {
  const STEP = 0.01;
  it.each([RING_XXL_TILES - STEP, RING_XXL_TILES, RING_XXL_TILES + STEP])('a ring of %s tiles', async (radius) => {
    for (const r of RELIEFS) {
      expect(await sweep(r, r.footSteep, ringGridFor(radius, radius), radius, radius, HEADINGS), r.id).toBeLessThanOrEqual(BURIAL_LIMIT);
    }
  }, 60_000);
});
