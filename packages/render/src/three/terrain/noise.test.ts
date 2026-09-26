import { describe, expect, it } from 'vitest';
import { boxBlur, fbm2, latticeValue, valueNoise2 } from './noise';

describe('valueNoise2', () => {
  it('passes through its lattice values exactly', () => {
    for (let i = -3; i <= 3; i++)
      for (let j = -3; j <= 3; j++) expect(valueNoise2(i / 1.5, j / 1.5, 1.5, 7)).toBeCloseTo(latticeValue(i, j, 7), 12);
  });
  it('stays inside [-1, 1] and actually varies', () => {
    let lo = Infinity;
    let hi = -Infinity;
    for (let k = 0; k < 20000; k++) {
      const v = valueNoise2(k * 0.0137, k * 0.0071, 1.5, 3);
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    expect(lo).toBeGreaterThanOrEqual(-1);
    expect(hi).toBeLessThanOrEqual(1);
    expect(hi - lo).toBeGreaterThan(1);
  });
  it('is a pure function of its arguments, and the seed matters', () => {
    expect(valueNoise2(3.3, 4.4, 2, 1)).toBe(valueNoise2(3.3, 4.4, 2, 1));
    let same = 0;
    for (let k = 0; k < 50; k++) if (valueNoise2(k * 0.37, 1.1, 2, 1) === valueNoise2(k * 0.37, 1.1, 2, 2)) same++;
    expect(same).toBeLessThan(5);
  });
  // The quintic fade makes the field C1 across every lattice line, so a bent
  // edge has no kinks. A linear fade breaks the slope at every line.
  it('has no slope break across a lattice line', () => {
    const h = 1e-5;
    let worst = 0;
    for (let i = 1; i <= 20; i++) {
      const x = i / 1.5;
      const z = 0.37 + i * 0.11;
      const left = (valueNoise2(x, z, 1.5, 5) - valueNoise2(x - h, z, 1.5, 5)) / h;
      const right = (valueNoise2(x + h, z, 1.5, 5) - valueNoise2(x, z, 1.5, 5)) / h;
      worst = Math.max(worst, Math.abs(left - right));
    }
    expect(worst).toBeLessThan(0.01);
  });
});

describe('fbm2', () => {
  it('stays in [-1, 1] and averages near zero', () => {
    let sum = 0;
    let n = 0;
    for (let z = 0; z < 48; z += 0.25)
      for (let x = 0; x < 48; x += 0.25) {
        const v = fbm2(x, z, 12, 3, 11);
        expect(Math.abs(v)).toBeLessThanOrEqual(1);
        sum += v;
        n++;
      }
    expect(Math.abs(sum / n)).toBeLessThan(0.15);
  });
});

describe('boxBlur', () => {
  it('leaves a constant field constant', () => {
    const f = new Float32Array(64).fill(0.3);
    for (const v of boxBlur(f, 8, 8, 2)) expect(v).toBeCloseTo(0.3, 6);
  });
  it('is the identity at radius 0', () => {
    const f = Float32Array.from({ length: 16 }, (_, i) => i);
    expect(Array.from(boxBlur(f, 4, 4, 0))).toEqual(Array.from(f));
  });
  it('spreads an interior impulse over a (2r+1)^2 square that sums to the impulse', () => {
    const f = new Float32Array(21 * 21);
    f[10 * 21 + 10] = 1;
    const b = boxBlur(f, 21, 21, 2);
    let sum = 0;
    let nonzero = 0;
    for (const v of b) {
      sum += v;
      if (v > 0) nonzero++;
    }
    expect(sum).toBeCloseTo(1, 6);
    expect(nonzero).toBe(25);
  });
});
