import { describe, expect, it } from 'vitest';
import { rotorWashStrength, ROTOR_WASH_MIN_STRENGTH } from './rotor-wash';

describe('rotorWashStrength', () => {
  it('is strongest hovering low', () => {
    expect(rotorWashStrength(0.3, 0)).toBe(1);
  });
  it('falls with height and vanishes high up', () => {
    expect(rotorWashStrength(1.5, 0)).toBeLessThan(rotorWashStrength(0.8, 0));
    expect(rotorWashStrength(3.5, 0)).toBe(0);
    expect(rotorWashStrength(3.5, 0)).toBeLessThan(ROTOR_WASH_MIN_STRENGTH);
  });
  it('thins with speed but never below half at low height', () => {
    expect(rotorWashStrength(0.3, 2)).toBeLessThan(rotorWashStrength(0.3, 0));
    expect(rotorWashStrength(0.3, 9)).toBe(0.5);
  });
});
