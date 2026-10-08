import { describe, expect, it } from 'vitest';
import { vehicleTrailsDamageSmoke } from './exhaust-slots';

describe('vehicleTrailsDamageSmoke (pass C2/C4, P3)', () => {
  const tank = { isSoft: false, isAir: false };
  it('smokes a ground vehicle with a mobility kill, a firepower kill, or both', () => {
    expect(vehicleTrailsDamageSmoke(tank, 1, 0)).toBe(true);
    expect(vehicleTrailsDamageSmoke(tank, 0, 1)).toBe(true);
    expect(vehicleTrailsDamageSmoke(tank, 1, 1)).toBe(true);
  });
  it('never smokes a healthy vehicle, a soft unit or an aircraft', () => {
    expect(vehicleTrailsDamageSmoke(tank, 0, 0)).toBe(false);
    expect(vehicleTrailsDamageSmoke({ isSoft: true, isAir: false }, 1, 1)).toBe(false);
    expect(vehicleTrailsDamageSmoke({ isSoft: false, isAir: true }, 1, 1)).toBe(false);
  });
});
