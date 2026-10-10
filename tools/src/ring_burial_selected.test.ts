/**
 * GH-346: the SELECTED ring draws at `SELECTED_RING_SCALE` x its type's own
 * radius or ellipse, so it is a bigger ring than `ring_burial.test.ts` sweeps.
 * The same sweep, at the drawn size, on the grid `ringGridFor` picks for it.
 * (The unselected team ring draws at 1x, which that file already covers.)
 */
import { describe, expect, it } from 'vitest';
import { ELLIPSE_BY_TYPE, RADIUS_BY_TYPE, SELECTED_RING_SCALE } from '../../packages/render/src/three/units/readability';
import { ringGridFor } from '../../packages/render/src/three/units/selection-ring';
import { BURIAL_LIMIT, CENTRE, HEADINGS, RELIEFS, sweep } from './ring_burial_sweep';

const k = SELECTED_RING_SCALE;

describe('every selected ring, at its drawn size, stays on the relief (GH-346)', () => {
  const circles = [...new Set(Object.entries(RADIUS_BY_TYPE).filter(([id]) => !ELLIPSE_BY_TYPE[id]).map(([, r]) => r * k))];

  it.each(circles)('the circle at %s tiles', async (radius) => {
    for (const r of RELIEFS) {
      expect(await sweep(r, r.footSteep, ringGridFor(radius, radius), radius, radius, [0]), r.id).toBeLessThanOrEqual(BURIAL_LIMIT);
    }
  });

  it.each(Object.entries(ELLIPSE_BY_TYPE))('the %s ellipse', async (_id, e) => {
    const a = e.along * k;
    const b = e.across * k;
    for (const r of RELIEFS) {
      expect(await sweep(r, r.vehicleSteep, ringGridFor(a, b), a, b, HEADINGS, CENTRE), r.id).toBeLessThanOrEqual(BURIAL_LIMIT);
    }
  }, 30_000);
});
