/**
 * Task B3.9. `structureWearStep`'s own doc comment explains why this module
 * duplicates `grind.ts`'s `structureHpBand` instead of importing it -- the
 * first test below is what makes that duplication safe: if the two ever
 * disagreed, this is the test that would catch it, not a code review months
 * later.
 */
import { describe, it, expect } from 'vitest';
import { structureHpBand } from '../../grind';
import { structureWearStep, dirtyForStructureHit, dirtyForStructureDestroyed } from './dirty';

describe('structureWearStep', () => {
  it('agrees with grind.ts\'s structureHpBand across a spread of hp/maxHp, including maxHp <= 0', () => {
    const maxHps = [0, 1, 40, 100, 250];
    for (const maxHp of maxHps) {
      for (let hp = -10; hp <= maxHp + 10; hp += 5) {
        expect(structureWearStep(hp, maxHp)).toBe(structureHpBand(hp, maxHp));
      }
    }
  });

  it('is 8 (untouched) at full health and 0 at destroyed', () => {
    expect(structureWearStep(100, 100)).toBe(8);
    expect(structureWearStep(0, 100)).toBe(0);
  });

  it('clamps to [0, 8] even for hp outside the natural range', () => {
    expect(structureWearStep(-50, 100)).toBe(0);
    expect(structureWearStep(500, 100)).toBe(8);
  });

  it('is 8 when maxHp is zero or negative, matching grind.ts\'s own fallback', () => {
    expect(structureWearStep(0, 0)).toBe(8);
    expect(structureWearStep(10, -5)).toBe(8);
  });
});

describe('dirtyForStructureHit', () => {
  const FOOTPRINT = [12, 13, 14]; // a 3-tile footprint, deliberately more than one tile --
  // a break that collapsed the result to just the structure's OWN first tile
  // (rather than its whole footprint) needs a multi-tile fixture to be
  // catchable at all; see this file's own "break checks" describe block.

  it('returns null when a hit does not cross a wear step (the common case)', () => {
    // 91/100 and 88/100 both round up to wear step 8 (ceil(91*8/100)=8,
    // ceil(88*8/100)=8) -- two hits landing in the same eighth.
    const first = dirtyForStructureHit(FOOTPRINT, 0xff, 91, 100);
    expect(first.dirty).not.toBeNull();
    const second = dirtyForStructureHit(FOOTPRINT, first.wearStep, 88, 100);
    expect(second.dirty).toBeNull();
    expect(second.wearStep).toBe(first.wearStep);
  });

  it('returns the dirty region, unmodified, when a hit crosses a wear step', () => {
    const result = dirtyForStructureHit(FOOTPRINT, structureWearStep(100, 100), 40, 100);
    expect(result.dirty).not.toBeNull();
    expect(result.dirty?.kind).toBe('wear');
    expect(result.dirty?.tiles).toEqual(FOOTPRINT);
    expect(result.wearStep).toBe(structureWearStep(40, 100));
  });

  it('the very first hit (sentinel prevWearStep) always redraws', () => {
    // ThreeRenderer's own lazy-grown wear array starts at 0xff (mirroring
    // PixiRenderer's `bumpStructureWear`), a value structureWearStep can
    // never itself produce (its range is 0..8) -- so the first hit on any
    // structure is always dirty, exactly once, never on every subsequent
    // hit at the same band.
    const result = dirtyForStructureHit(FOOTPRINT, 0xff, 100, 100);
    expect(result.dirty).not.toBeNull();
  });
});

describe('dirtyForStructureDestroyed', () => {
  const FOOTPRINT = [40, 41, 52]; // multi-tile, same reasoning as above.

  it('is always dirty, kind "unblocked", over the whole footprint', () => {
    const result = dirtyForStructureDestroyed(FOOTPRINT);
    expect(result.kind).toBe('unblocked');
    expect(result.tiles).toEqual(FOOTPRINT);
  });
});

describe('break checks (Task B3.9 brief, run by hand against a temporarily-edited dirty.ts)', () => {
  // These three assertions are what the brief's own break checks are graded
  // against -- see the task report for which one actually failed when each
  // break was introduced. Kept here, passing, as the permanent regression
  // guard; the breaks themselves are not committed.

  it('break 1 (dirty.ts returns "the whole map"): tiles must equal the given footprint exactly, not something larger', () => {
    const footprint = [7];
    const result = dirtyForStructureHit(footprint, 0xff, 50, 100);
    expect(result.dirty?.tiles).toEqual(footprint);
    expect(result.dirty?.tiles.length).toBe(1);
  });

  it('break 2 (death dirties only one tile instead of the whole footprint): tiles must equal the whole multi-tile footprint', () => {
    const footprint = [3, 4, 5, 9];
    const result = dirtyForStructureDestroyed(footprint);
    expect(result.tiles).toEqual(footprint);
    expect(result.tiles.length).toBe(footprint.length);
  });

  it('break 3 (wear quantisation removed): two hits in the SAME eighth, at DIFFERENT hp, must not both be dirty', () => {
    // Deliberately not the same hp twice -- an unquantised "return hp
    // itself" implementation would still correctly no-op on an identical
    // repeat, since nothing about the input changed either. The break only
    // shows up when hp moves within a band a quantised implementation
    // collapses to the same step: 91 and 88 both round up to wear step 8
    // (ceil(91*8/100) === ceil(88*8/100) === 8), so a second hit landing in
    // the same eighth must still be a no-op.
    const footprint = [1, 2];
    const first = dirtyForStructureHit(footprint, 0xff, 91, 100);
    const second = dirtyForStructureHit(footprint, first.wearStep, 88, 100);
    expect(second.dirty).toBeNull();
  });
});
