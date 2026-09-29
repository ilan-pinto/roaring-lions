/**
 * A4 Task 5 (GH-186): a selection ring lies ON the relief, not partly under
 * it -- the every-type sweep and the Namer tripwires. The sweep itself is in
 * `ring_burial_sweep.ts` and the tier-boundary specs are in
 * `ring_burial_large.test.ts` / `ring_burial_xl.test.ts`: one file was 55-61 s
 * of synchronous CPU and tipped vitest's 60 s worker RPC timeout ("Timeout
 * calling onTaskUpdate") on a slow CI runner. See that file's header.
 */
import { describe, expect, it } from 'vitest';
import { ELLIPSE_BY_TYPE, RADIUS_BY_TYPE } from '../../packages/render/src/three/units/readability';
import { RING_GRID, RING_GRID_XL, ringGridFor } from '../../packages/render/src/three/units/selection-ring';
import { BURIAL_LIMIT, CENTRE, HEADINGS, RELIEFS, sweep } from './ring_burial_sweep';

describe('the sweep is not vacuous', () => {
  it('both relief maps carry hundreds of steep tiles, for foot and vehicle alike', () => {
    for (const r of RELIEFS) {
      expect(r.footSteep.length, r.id).toBeGreaterThan(300);
      expect(r.vehicleSteep.length, r.id).toBeGreaterThan(300);
    }
  });
});

describe('every shipped ring, on the grid ringGridFor picks, stays on the relief (GH-186)', () => {
  // Circles are drawn at heading 0 (`pushSelectionRing` passes none), so one
  // heading is the real case; ellipses turn with the hull, so all eight.
  const circles = [...new Set(Object.entries(RADIUS_BY_TYPE).filter(([id]) => !ELLIPSE_BY_TYPE[id]).map(([, r]) => r))];

  it.each(circles)('the circle at %s tiles', async (radius) => {
    for (const r of RELIEFS) {
      expect(await sweep(r, r.footSteep, ringGridFor(radius, radius), radius, radius, [0]), r.id).toBeLessThanOrEqual(BURIAL_LIMIT);
    }
  });

  // Ellipses at tile centres only, to keep this file affordable (eight
  // headings times five offsets was 4 s a type). Measured with the five
  // offsets over EVERY open tile of both maps in fix round 3, every shipped
  // ellipse on its tier buried 0.0000 wu -- nothing near the limit for an
  // offset to find. The boundary sweep below keeps the offsets.
  it.each(Object.entries(ELLIPSE_BY_TYPE))('the %s ellipse', async (_id, e) => {
    for (const r of RELIEFS) {
      expect(await sweep(r, r.vehicleSteep, ringGridFor(e.along, e.across), e.along, e.across, HEADINGS, CENTRE), r.id).toBeLessThanOrEqual(BURIAL_LIMIT);
    }
  }, 30_000);
});

describe('Namer tier-justification tripwires (fail safe; the per-type sweep above is the real guard)', () => {
  // These only prove the tiers are NEEDED: if the ground or the lift changed
  // so the Namer no longer buried on the smaller grids, they would go red and
  // say the tiers can be revisited. They never excuse a bury.
  const tm = RELIEFS[0];
  const { along, across } = ELLIPSE_BY_TYPE.ifv_namer;

  it('on the 4x4 grid the Namer ellipse is buried by over 0.1 wu on tel_marum', async () => {
    expect(await sweep(tm, tm.vehicleSteep, RING_GRID, along, across, HEADINGS, CENTRE)).toBeGreaterThan(0.1);
  }, 30_000);

  it('on the 6x6 grid the grown Namer (1.61 x 1.03) is buried past the limit on tel_marum', async () => {
    expect(await sweep(tm, tm.vehicleSteep, 6, along, across, HEADINGS, CENTRE)).toBeGreaterThan(BURIAL_LIMIT);
  }, 30_000);

  it('the Namer is on the 7x7 tier', () => {
    expect(ringGridFor(along, across)).toBe(RING_GRID_XL);
  });
});
