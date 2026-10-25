import { describe, expect, it } from 'vitest';
import { fx, ONE, QUARTER_TURN } from './fixed';
import mbtLaviJson from '../../../data/units/kdf/mbt_lavi.json';
import { unitTypeFromJson, type UnitTypeJson } from './sim';
import { capsuleOverlap, hullCapsule } from './separation';

const L = 57016, W = 31457, C = -11796; // the Lavi, V-R3
const cap = (...hulls: [number, number, number][]): Int32Array => {
  const c = new Int32Array(hulls.length * 5);
  hulls.forEach(([x, y, f], k) => hullCapsule(fx.from(x), fx.from(y), f, L, W, C, c, k * 5));
  return c;
};
const out = new Int32Array(4);

describe('capsule geometry (GH-421)', () => {
  it('a hull facing east is a segment along x, centred 0.18 tile behind its origin', () => {
    expect([...cap([10, 10, 0])]).toEqual([618005, 655360, 669123, 655360, 31457]);
  });
  it('a hull facing south (a quarter turn, y-down) is the same segment along y', () => {
    expect([...cap([10, 10, ONE / 4])]).toEqual([655360, 618005, 655360, 669123, 31457]);
  });
  it('side by side 0.9 tile apart: overlap 3933 (0.96 - 0.9, less one unit of floor)', () => {
    expect(capsuleOverlap(cap([10, 10, 0], [10, 10.9, 0]), 0, 5, out)).toBe(3933);
    expect([out[0], out[1]]).toEqual([0, -65537]); // B is south of A: A is pushed north (floored sqrt: 58982 / 58981)
  });
  it('nose to tail 1.5 tiles apart: overlap 15729 -- a circle of the half-width reads apart', () => {
    expect(capsuleOverlap(cap([10, 10, 0], [11.5, 10, 0]), 0, 5, out)).toBe(15729);
    expect(fx.from(1.5)).toBeGreaterThan(2 * W); // the circle's verdict, for contrast
  });
  it('nose to tail with B BEHIND A: the same overlap, the normal along +x (the t > ONE branch)', () => {
    expect(capsuleOverlap(cap([10, 10, 0], [8.5, 10, 0]), 0, 5, out)).toBe(15729);
    expect([out[0], out[1]]).toEqual([65537, 0]);
  });
  it('coincident hulls: overlap is the radius sum and the normal is (0, 0)', () => {
    expect(capsuleOverlap(cap([10.5, 10.5, 0], [10.5, 10.5, 0]), 0, 5, out)).toBe(62914);
    expect([out[0], out[1]]).toEqual([0, 0]);
  });
  it('2.2 tiles nose to tail is apart', () => {
    expect(capsuleOverlap(cap([10, 10, 0], [12.2, 10, 0]), 0, 5, out)).toBeLessThan(0);
  });
  it('a point-shaped A (half length = half width) beyond B\'s nose clamps to B\'s end (the aa === 0 branch)', () => {
    // A: a circle of radius 0.5 (32768) at (13, 10) = 851968. B: the Lavi at (10, 10), nose end x = 669123 (above).
    // Clamped, Q = (669123, 655360), so dx = 851968 - 669123 = 182845, d = 182845 less one unit of floored sqrt
    // (182844), and the overlap is 32768 + 31457 - 182844 = -118619. Unclamped, t = 233963 / 51118 = 4.58 puts Q far past the nose.
    const c = new Int32Array(10);
    hullCapsule(fx.from(13), fx.from(10), 0, 32768, 32768, 0, c, 0);
    hullCapsule(fx.from(10), fx.from(10), 0, L, W, C, c, 5);
    expect(capsuleOverlap(c, 0, 5, out)).toBe(-118619);
    expect([out[0], out[1]]).toEqual([65536, 0]);
  });
  it('a capsule built from the loaded mbt_lavi type (Task 1 data), facing east and south', () => {
    // Hand-derived, fx semantics (from() rounds half away from zero): half_length 1.03 -> 67502,
    // half_width 0.57 -> 37356, centre -0.22 -> -14418. Segment half h = 67502 - 37356 = 30146.
    // Origin (10, 10) = 655360. East: cos = ONE, sin = 0, so the centre is x = 655360 - 14418 = 640942
    // and the ends are 640942 -/+ 30146 = 610796 / 671088 at y = 655360. South (QUARTER_TURN): cos = 0,
    // sin = ONE, so the same along y.
    const t = unitTypeFromJson(mbtLaviJson as unknown as UnitTypeJson);
    expect([t.sepHalfLen, t.sepHalfWid, t.sepCentre]).toEqual([67502, 37356, -14418]);
    const c = new Int32Array(10);
    hullCapsule(fx.from(10), fx.from(10), 0, t.sepHalfLen, t.sepHalfWid, t.sepCentre, c, 0);
    hullCapsule(fx.from(10), fx.from(10), QUARTER_TURN, t.sepHalfLen, t.sepHalfWid, t.sepCentre, c, 5);
    expect([...c.slice(0, 5)]).toEqual([610796, 655360, 671088, 655360, 37356]);
    expect([...c.slice(5)]).toEqual([655360, 610796, 655360, 671088, 37356]);
  });
});
