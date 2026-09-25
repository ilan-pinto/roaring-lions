/**
 * The only maths `scorch-decals.ts` still owns after the decal pool (D5)
 * took over drawing: the radius curve. See that file's top comment.
 */
import { describe, expect, it } from 'vitest';
import { scorchRadiusTiles } from './scorch-decals';

describe('scorchRadiusTiles', () => {
  // Strength scales; a mortar bomb leaves a smaller mark than a burning hull,
  // and sqrt rather than linear because the mark is an AREA -- a 0.3-power
  // round that left 30% of the radius would leave 9% of the mark and read as
  // nothing at all.
  it('grows with power, sublinearly, and is zero at zero', () => {
    expect(scorchRadiusTiles(0)).toBe(0);
    expect(scorchRadiusTiles(1)).toBeGreaterThan(scorchRadiusTiles(0.3));
    expect(scorchRadiusTiles(0.3)).toBeGreaterThan(0.3 * scorchRadiusTiles(1));
  });
});
