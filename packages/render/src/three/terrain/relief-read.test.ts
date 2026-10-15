/**
 * Relief read's pure maths (`relief-read.ts`). Oracles are literals or
 * trigonometry written out here, never the module's own helpers, so moving a
 * constant cannot move its test with it.
 */
import { describe, expect, it } from 'vitest';
import {
  RELIEF_ALBEDO_GLSL,
  RELIEF_CONTOUR_STRENGTH,
  RELIEF_FRAGMENT_GLSL,
  RELIEF_SLOPE_GAIN,
  RELIEF_SLOPE_MAX_TILT_DEG,
  RELIEF_TINT_HIGH,
  RELIEF_TINT_LOW,
  contourFactor,
  exaggerateNormal,
  reliefTint,
} from './relief-read';

const deg = (r: number) => (r * 180) / Math.PI;
const tiltOf = (n: readonly number[]) => deg(Math.atan2(Math.hypot(n[0]!, n[2]!), n[1]!));
const fromTilt = (tiltDeg: number, azDeg = 30): [number, number, number] => {
  const t = (tiltDeg * Math.PI) / 180;
  const a = (azDeg * Math.PI) / 180;
  return [Math.sin(t) * Math.cos(a), Math.cos(t), Math.sin(t) * Math.sin(a)];
};

describe('exaggerateNormal (slope light)', () => {
  it('leaves flat ground exactly flat: a flat map does not move', () => {
    expect(exaggerateNormal([0, 1, 0])).toEqual([0, 1, 0]);
  });

  it('leaves a wall face (no vertical part) and a back face alone', () => {
    expect(exaggerateNormal([1, 0, 0])).toEqual([1, 0, 0]);
    expect(exaggerateNormal([0.3, -0.9, 0.1])).toEqual([0.3, -0.9, 0.1]);
  });

  it('steepens a gentle slope to atan(2 tan(tilt)): 6 degrees reads as 11.87', () => {
    // A 3-level bluff over 3 tiles of smooth ground is about this gentle.
    const out = exaggerateNormal(fromTilt(6));
    expect(tiltOf(out)).toBeCloseTo(11.87, 2); // atan(2 x 0.105104) = 11.871 deg
    expect(RELIEF_SLOPE_GAIN).toBe(2);
  });

  it('keeps the slope facing the same way (azimuth unchanged) and unit length', () => {
    const out = exaggerateNormal(fromTilt(10, 123));
    expect(deg(Math.atan2(out[2], out[0]))).toBeCloseTo(123, 6);
    expect(Math.hypot(...out)).toBeCloseTo(1, 9);
  });

  it('never exaggerates past the ceiling: 30 degrees would be 49, it stops at the cap', () => {
    expect(tiltOf(exaggerateNormal(fromTilt(30)))).toBeCloseTo(RELIEF_SLOPE_MAX_TILT_DEG, 6);
    expect(RELIEF_SLOPE_MAX_TILT_DEG).toBeLessThan(45);
  });

  it('never flattens a slope already steeper than the ceiling', () => {
    expect(tiltOf(exaggerateNormal(fromTilt(60)))).toBeCloseTo(60, 6);
  });

  it('is the identity at gain 1 (the debug layer\'s hidden state)', () => {
    const n = fromTilt(14, 200);
    exaggerateNormal(n, 1).forEach((v, i) => expect(v).toBeCloseTo(n[i]!, 12));
  });
});

describe('contourFactor (height contours)', () => {
  it('draws nothing on flat ground at a whole level (fwidth 0)', () => {
    expect(contourFactor(3, 0)).toBe(1);
    expect(contourFactor(0, 0)).toBe(1);
  });

  it('darkens by the full strength exactly on a half level', () => {
    expect(contourFactor(2.5, 0.05)).toBeCloseTo(1 - 0.18, 9);
    expect(RELIEF_CONTOUR_STRENGTH).toBe(0.18);
  });

  it('is a LINE: a few pixels from the half level it is gone', () => {
    // 0.05 levels a pixel: 0.1 levels off the half level is 2 px, past the 1.4 px width.
    expect(contourFactor(2.6, 0.05)).toBe(1);
    expect(contourFactor(2.52, 0.05)).toBeLessThan(1);
  });

  it('keeps its pixel width whatever the zoom (scales with fwidth)', () => {
    expect(contourFactor(2.5 + 0.02, 0.05)).toBeCloseTo(contourFactor(2.5 + 0.08, 0.2), 12);
  });
});

describe('reliefTint (height tint, relative to the map median)', () => {
  it('is exactly 1 at the median: a flat map, all median, does not move', () => {
    expect(reliefTint(0, 0)).toEqual([1, 1, 1]);
    expect(reliefTint(3, 3)).toEqual([1, 1, 1]);
  });

  it('reaches the low / high ends four levels below / above the median, and clamps past them', () => {
    expect(reliefTint(1, 5)).toEqual([...RELIEF_TINT_LOW]);
    expect(reliefTint(9, 5)).toEqual([...RELIEF_TINT_HIGH]);
    expect(reliefTint(-10, 5)).toEqual([...RELIEF_TINT_LOW]);
  });

  it('low is darker and cooler, high lighter and warmer', () => {
    const lo = reliefTint(0, 4);
    const hi = reliefTint(8, 4);
    expect(lo[0]).toBeLessThan(1);
    expect(lo[2]).toBeGreaterThan(lo[0]);
    expect(hi[0]).toBeGreaterThan(1);
    expect(hi[0]).toBeGreaterThan(hi[2]);
  });

  it('is 1 everywhere at amplitude 0 (the debug layer\'s hidden state)', () => {
    expect(reliefTint(0, 5, 0)).toEqual([1, 1, 1]);
  });
});

describe('the GLSL is generated from the same constants', () => {
  it('carries the cap, the strength and both tint ends', () => {
    expect(RELIEF_FRAGMENT_GLSL).toContain(((RELIEF_SLOPE_MAX_TILT_DEG * Math.PI) / 180).toFixed(5));
    expect(RELIEF_ALBEDO_GLSL).toContain(RELIEF_CONTOUR_STRENGTH.toFixed(5));
    expect(RELIEF_ALBEDO_GLSL).toContain(RELIEF_TINT_LOW[0].toFixed(5));
    expect(RELIEF_ALBEDO_GLSL).toContain(RELIEF_TINT_HIGH[0].toFixed(5));
  });

  it('only ever touches ground TOPS: the albedo term is gated on rlTop', () => {
    expect(RELIEF_ALBEDO_GLSL).toMatch(/mix\(vec3\(1\.0\), rlTint \* rlLine, rlTop\)/);
  });
});
