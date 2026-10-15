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
  // GH-31: the band-driven wisp. Mutations seen red: drop the band rule
  // (`return vehicleWispsAtBand(...)` -> `return false`); drop the `isAir`
  // check (the helicopter row); refuse `isSoft` before the band rule (the
  // jeep row).
  it('wisps any hull drawn at band 2..1, soft-skinned too, never at 3 and never an aircraft', () => {
    const jeep = { isSoft: true, isAir: false };
    const heli = { isSoft: true, isAir: true };
    expect(vehicleTrailsDamageSmoke(tank, 0, 0, 2)).toBe(true);
    expect(vehicleTrailsDamageSmoke(tank, 0, 0, 1)).toBe(true);
    expect(vehicleTrailsDamageSmoke(jeep, 0, 0, 1)).toBe(true);
    expect(vehicleTrailsDamageSmoke(tank, 0, 0, 3)).toBe(false);
    expect(vehicleTrailsDamageSmoke(heli, 0, 0, 1)).toBe(false);
    // Still one wisp: a component kill at a wisping band is the same answer.
    expect(vehicleTrailsDamageSmoke(tank, 1, 0, 1)).toBe(true);
  });
});
