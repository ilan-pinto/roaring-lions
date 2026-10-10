import { describe, expect, it } from 'vitest';
import { rotorSpinPhase } from './rotor-spin';

describe('rotorSpinPhase', () => {
  const RATE = Math.PI * 2;
  it('is a function of sim time alone: same time, same angle, however it was reached', () => {
    expect(rotorSpinPhase(7000, RATE)).toBe(rotorSpinPhase(7000, RATE));
  });
  it('advances with sim time and wraps once a turn', () => {
    expect(rotorSpinPhase(250, RATE)).toBeCloseTo(Math.PI / 2, 9);
    expect(rotorSpinPhase(1000, RATE)).toBeCloseTo(0, 9);
    expect(rotorSpinPhase(1250, RATE)).toBeCloseTo(Math.PI / 2, 9);
  });
  it('never leaves [0, 2*PI)', () => {
    for (let ms = 0; ms < 5000; ms += 37) {
      const p = rotorSpinPhase(ms, RATE);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThan(Math.PI * 2);
    }
  });
});
