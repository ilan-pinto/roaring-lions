import { describe, expect, it } from 'vitest';
import { VEHICLE_RANK_DEPTH, VEHICLE_SPACING } from '../../packages/sim/src/formation';
import { unitFootprintTable } from './perf/unit-footprints';

/**
 * The formation grid steps vehicle ranks VEHICLE_RANK_DEPTH tiles apart and
 * vehicles sideways VEHICLE_SPACING apart (GH-421). Both numbers are claims
 * about hull sizes, so they are checked against the measured hull GLBs: the
 * hull behind needs its front reach, the hull ahead its rear reach, and their
 * sum has to fit inside one rank step. A hull's reach is its half-length plus
 * how far its centre sits off the origin on that side.
 */
describe('vehicle formation ranks clear every hull pair (GH-421)', () => {
  const rows = unitFootprintTable().filter(
    (r) => r.vehicleHalfExtent !== null && (r.ringClass === 'light' || r.ringClass === 'armour')
  );
  const hulls = rows.map((r) => {
    const h = r.vehicleHalfExtent!;
    return {
      unit: r.unit,
      rear: h.along + Math.max(0, -h.centreAlong),
      front: h.along + Math.max(0, h.centreAlong),
      across: h.across,
    };
  });

  it('measures ground vehicles at all', () => {
    expect(hulls.length).toBeGreaterThanOrEqual(8);
  });

  it('fits the worst rank pair inside VEHICLE_RANK_DEPTH, and says which it is', () => {
    let worst = { need: -1, a: '', b: '' };
    for (const a of hulls) {
      for (const b of hulls) {
        const need = a.rear + b.front;
        if (need > worst.need) worst = { need, a: a.unit, b: b.unit };
      }
    }
    console.log(`worst rank pair: ${worst.a} ahead, ${worst.b} behind, needs ${worst.need.toFixed(3)} tiles`);
    expect(worst.need).toBeLessThan(VEHICLE_RANK_DEPTH);
    // An independent literal, so the test cannot be satisfied by changing only the
    // code under test. It was the 2.54 of the plan's census; E6 (GH-274) added
    // aa_remetz, a 7.6 m 6x6 whose front reach makes mbt_lavi_camo ahead of it
    // the worst pair at 2.581, still inside the 3-tile rank step.
    expect(worst.need).toBeGreaterThan(2.56);
    expect(worst.need).toBeLessThan(2.60);
  });

  it('fits the widest hull pair inside VEHICLE_SPACING sideways', () => {
    const widest = Math.max(...hulls.map((h) => h.across));
    expect(2 * widest).toBeLessThanOrEqual(VEHICLE_SPACING);
  });
});
