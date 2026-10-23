import { describe, it, expect } from 'vitest';
import { HDR_GAINS, muzzleGain, burstGain, streakKindGain } from './hdr-gains';

// The oracle is LITERALS (the lead's D2 rulings), not imports.
describe('HDR_GAINS', () => {
  it('pins every D2 value', () => {
    expect({ ...HDR_GAINS, streakKind: { ...HDR_GAINS.streakKind } }).toEqual({
      muzzleCore: 10,
      muzzleMid: 5,
      muzzleOuter: 2.2,
      burstCore: 8,
      burstMid: 4,
      burstOuter: 1.8,
      bolt: 4,
      arc: 3.5,
      sparks: 4,
      fireball: 2.6,
      streakKind: { rifle: 0.45, mg: 0.6, grenade: 0.06 },
      grenadeGlint: 0.4,
    });
  });
  it('is frozen', () => {
    expect(Object.isFrozen(HDR_GAINS)).toBe(true);
    expect(Object.isFrozen(HDR_GAINS.streakKind)).toBe(true);
  });
  it('role lookups hit the right entries', () => {
    expect([muzzleGain('core'), muzzleGain('mid'), muzzleGain('outer')]).toEqual([10, 5, 2.2]);
    expect([burstGain('core'), burstGain('mid'), burstGain('outer')]).toEqual([8, 4, 1.8]);
    expect([streakKindGain('rifle'), streakKindGain('mg'), streakKindGain('bolt')]).toEqual([0.45, 0.6, 1]);
  });
});
