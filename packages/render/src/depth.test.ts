// The depth arithmetic that lets a ridge hide a unit behind it.
//
// Rendering does not generally get tests in this repo. This is arithmetic, not
// rendering: three numbers whose ORDER is the whole feature, and an off-by-one
// puts a unit in front of the hill it is standing behind.
import { describe, expect, it } from 'vitest';
import { bandZ, unitZ } from './renderer';

describe('elevated terrain against the units around it', () => {
  const x = 10, y = 20;

  it('draws over a unit standing directly behind it', () => {
    // The case that ties if the band uses depthZ(x, y) unadjusted, and ties
    // resolve by insertion order -- which puts the unit on top, which is the
    // bug.
    expect(bandZ(x, y)).toBeGreaterThan(unitZ(x, y - 1));
  });

  it('draws under a unit standing on top of it', () => {
    expect(bandZ(x, y)).toBeLessThan(unitZ(x, y));
  });

  it('draws under a unit one tile in front of it', () => {
    expect(bandZ(x, y)).toBeLessThan(unitZ(x, y + 1));
  });

  it('gives every tile on a diagonal the same band', () => {
    // The bucketing is what keeps this to ~95 objects instead of ~2300.
    expect(bandZ(12, 18)).toBe(bandZ(10, 20));
    expect(bandZ(11, 20)).toBeGreaterThan(bandZ(10, 20));
  });
});
