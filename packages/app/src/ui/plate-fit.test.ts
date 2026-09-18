import { describe, expect, it } from 'vitest';
import { PLATE_SCALE_MAX, PLATE_SCALE_MIN, plateFit } from './plate-fit';

/** Every shipped plate is 1800 x 1200 -- one camera, one frame, seventeen
 *  different units inside it. That is the whole reason a per-unit zoom exists. */
const PLATE: readonly [number, number] = [1800, 1200];

describe('plateFit', () => {
  it('blows a rifleman up to the ceiling and leaves a carrier near its own size', () => {
    // sniper_team's footprint is 154 of 1800 -- 8.6% of the frame. Filling 60%
    // of the bay would take 7.01x; the ceiling is what it gets.
    expect(plateFit([154, 91], PLATE).scale).toBe(PLATE_SCALE_MAX);
    // apc_eitan is 744 of 1800, so 0.6 * 1800 / 744 = 1.4516.
    expect(plateFit([744, 549], PLATE).scale).toBe(1.45);
  });

  it('covers the whole shipped spread between the two', () => {
    // The other real extents, so a change to the formula shows its whole shape
    // rather than its two endpoints.
    expect(plateFit([823, 511], PLATE).scale).toBe(1.31); // ifv_namer, the widest
    expect(plateFit([636, 448], PLATE).scale).toBe(1.7); // mbt_lavi
    expect(plateFit([280, 196], PLATE).scale).toBe(PLATE_SCALE_MAX); // inf_squad, 3.86x wanted
    expect(plateFit([139, 106], PLATE).scale).toBe(PLATE_SCALE_MAX); // attack_drone, the smallest
  });

  it('never shrinks a unit that already fills its plate', () => {
    // Wanted is 0.6 and the margin bound is 0.91: both below 1, and the floor
    // is what a plate with nothing to gain gets. Shrinking would only add
    // letterboxing to a picture that already fits.
    expect(plateFit(PLATE, PLATE).scale).toBe(PLATE_SCALE_MIN);
    expect(plateFit([1500, 1000], PLATE).scale).toBe(PLATE_SCALE_MIN);
  });

  it('lets the margin bound cut a zoom the fill rule asked for', () => {
    // 400 wide wants 2.7x and clamps to the 2.5x ceiling -- but 900 of 1200
    // tall means the tenth-of-itself margin is gone at 1.21x, so the HEIGHT
    // bound is what this unit actually gets. Without it the figure's own head
    // and feet would be cropped by the bay.
    expect(plateFit([400, 900], PLATE).scale).toBe(1.21);
    expect(plateFit([400, 900], PLATE).scale).toBeLessThan(PLATE_SCALE_MAX);
  });

  // Worth knowing before anyone changes `fill`: at 0.6 the WIDTH half of the
  // margin bound is unreachable, because filling 60% of the frame can never
  // leave less than a tenth of the footprint outside it (0.6 < 1 / 1.1). Only
  // a tall unit can be cut, and only by the height half -- which is why the
  // wide-and-low case below is decided by the fill rule and not by a margin.
  it('cannot be cut on width at the shipped fill, and can be above it', () => {
    expect(plateFit([1000, 200], PLATE).scale).toBe(1.08); // the fill rule, not a margin
    expect(plateFit([1700, 200], PLATE).scale).toBe(PLATE_SCALE_MIN);
    // Ask for the whole frame and the width margin binds at last: 1.8x wanted,
    // 1.64x is where a tenth of a 1000-wide footprint still fits.
    expect(plateFit([1000, 200], PLATE, 1).scale).toBe(1.64);
  });

  it('honours a caller-supplied fill', () => {
    // 0.9 of the bay wants 2.18x for apc_eitan, and its own height cuts that
    // to 1.99 -- the margin bound doing real work at a fill the screen does
    // not use, which is the case a future change to PLATE_FILL would meet.
    expect(plateFit([744, 549], PLATE, 0.9).scale).toBe(1.99);
    expect(plateFit([744, 549], PLATE, 0.3).scale).toBe(PLATE_SCALE_MIN);
  });

  it('is the floor, never a throw, for a footprint the capture measured as nothing', () => {
    expect(plateFit([0, 0], PLATE).scale).toBe(PLATE_SCALE_MIN);
    expect(plateFit([154, 0], PLATE).scale).toBe(PLATE_SCALE_MIN);
    expect(plateFit([154, 91], [0, 0]).scale).toBe(PLATE_SCALE_MIN);
  });

  it('agrees with the shipped manifest about every plate, and none is left at 1', async () => {
    // The point of the feature, swept across what actually ships: every unit's
    // footprint ends up somewhere near the target, and not one of the
    // seventeen is still drawn at its own tiny plate scale.
    const manifest = (await import('../../../../assets/ui/plates/units/manifest.json')) as unknown as {
      default: { plates: Record<string, { width: number; height: number; extent: number[] }> };
    };
    const plates = Object.entries(manifest.default.plates);
    expect(plates.length).toBeGreaterThan(10);
    for (const [id, p] of plates) {
      const { scale } = plateFit([p.extent[0], p.extent[1]], [p.width, p.height]);
      expect(scale, id).toBeGreaterThan(PLATE_SCALE_MIN);
      expect(scale, id).toBeLessThanOrEqual(PLATE_SCALE_MAX);
      // Nothing is cropped: the footprint plus its margin still fits.
      expect((p.extent[0] * scale * 1.1) / p.width, id).toBeLessThanOrEqual(1.0001);
      expect((p.extent[1] * scale * 1.1) / p.height, id).toBeLessThanOrEqual(1.0001);
    }
  });
});
