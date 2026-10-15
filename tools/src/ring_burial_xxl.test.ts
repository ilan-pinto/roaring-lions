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
    // Every steep tile of both reliefs at five offsets and eight headings, on the
    // 9x9 tier's grid: the costliest of the boundary sweeps, and exhaustive by
    // design, so it is not cut. Measured single-file, Apple M3 Pro, 2026-10-15,
    // fifteen rings (five runs) with the load average at 13-79 on 12 cores (two
    // runs on the efficiency cores alone): 7.1-27.6 s a ring, against 2.1-11.5 s
    // for `ring_burial_xl`/`_large`; 4.4 s for one ring at load 33. One ring
    // crossed the old 60 s under a full parallel `pnpm test` (timed out at
    // 60.5 s), not single-file. The sweep yields every 250 ms, so a long ring
    // cannot starve vitest's worker RPC. The margin is for contention only.
  }, 180_000);
});
