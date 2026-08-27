import { describe, it, expect } from 'vitest';
import { groundLevelAt, groundWorldY } from './ground-height';
import { WORLD_PER_LEVEL } from './terrain/shared';

const W = 4, H = 4;
const flat = null;
const stepped = new Uint8Array([
  0, 0, 3, 3,
  0, 0, 3, 3,
  0, 0, 3, 3,
  0, 0, 3, 3,
]);

describe('groundLevelAt', () => {
  it('is zero everywhere with no elevation layer', () => {
    expect(groundLevelAt(flat, W, H, 1.5, 2.5)).toBe(0);
  });

  it('samples the containing tile, not the nearest corner', () => {
    // Terraces, not ramps -- matching Pixi's groundOffset and B2's mesh.
    // Anywhere inside tile (1, y) is level 0; anywhere inside (2, y) is 3.
    expect(groundLevelAt(stepped, W, H, 1.01, 0.5)).toBe(0);
    expect(groundLevelAt(stepped, W, H, 1.99, 0.5)).toBe(0);
    expect(groundLevelAt(stepped, W, H, 2.01, 0.5)).toBe(3);
  });

  it('does not interpolate across the terrace edge', () => {
    // The failure this exists to prevent: a unit sliding smoothly up a cliff
    // face instead of stepping onto it, its feet hanging in mid-air the whole
    // way. Sampling two points either side of x = 2 must give exactly 0 and 3.
    const lo = groundLevelAt(stepped, W, H, 1.999, 1.5);
    const hi = groundLevelAt(stepped, W, H, 2.001, 1.5);
    expect(hi - lo).toBe(3);
  });

  it('clamps off-map rather than reading out of bounds', () => {
    expect(groundLevelAt(stepped, W, H, -1, -1)).toBe(0);
    expect(groundLevelAt(stepped, W, H, 99, 99)).toBe(0);
  });
});

describe('groundWorldY', () => {
  it('converts levels to the same world height the mesh uses', () => {
    // Derived, not chosen: if these ever disagree, units float or sink.
    expect(groundWorldY(stepped, W, H, 2.5, 2.5)).toBeCloseTo(3 * WORLD_PER_LEVEL, 10);
  });
});
