import { describe, expect, it } from 'vitest';
import { landingDelayS, pulseAt, PULSE_MIN_GAP_S, PULSE_S, PULSE_START_SCALE } from './fire-link';

describe('pulseAt', () => {
  it('starts wide and lands on the ring', () => {
    expect(pulseAt(0)?.scale).toBeCloseTo(PULSE_START_SCALE);
    expect(pulseAt(PULSE_S * 0.999)?.scale).toBeCloseTo(1, 2);
    expect(pulseAt(PULSE_S)).toBeNull();
    expect(pulseAt(-0.01)).toBeNull();
  });
  it('fades as it contracts', () => {
    const a = pulseAt(0.05)?.alpha ?? 0;
    const b = pulseAt(0.3)?.alpha ?? 0;
    expect(a).toBeGreaterThan(b);
  });
  it('throttles to fewer pulses than an HMG fires events (one every 0.15 s)', () => {
    expect(PULSE_MIN_GAP_S).toBeGreaterThan(0.15);
    expect(PULSE_MIN_GAP_S).toBeLessThan(PULSE_S);
  });
});

describe('landingDelayS', () => {
  it('is immediate for a tracer and the flight time for a round', () => {
    expect(landingDelayS(null)).toBe(0);
    expect(landingDelayS(0.3)).toBe(0.3);
    expect(landingDelayS(-1)).toBe(0);
  });
});
