import { describe, expect, it } from 'vitest';
import { fx, ONE } from './fixed';
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
});
