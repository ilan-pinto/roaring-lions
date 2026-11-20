import { describe, it, expect } from 'vitest';
import { HDR_GAINS, DUSK_RING_COMPOSITE_CEILING, muzzleGain, burstGain, streakKindGain, teamRingGain } from './hdr-gains';
import { TEAM_RING } from './readability';
import { BLOOM_THRESHOLD } from '../bloom-spec';
import palette from '../../../../../data/palette.json';

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
      // GH-1197: the approved mock v2's ring edge (emission 1.3 over the body's 1.0).
      shockRingEdge: 1.3,
      beamCore: 4,
      beamSheath: 1.6,
      beamGlow: 2.4,
      streakKind: { rifle: 0.45, mg: 0.6, grenade: 0.06 },
      grenadeGlint: 0.4,
      hostileStreakMax: 12,
      duskTeamRing: 1.8,
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

/** sRGB hex -> linear luminance, written out here (an oracle, not an import of the code under test). */
function luminanceOf(hex: string): number {
  const lin = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => lin(v / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

describe('the dusk team ring (GH-1403, option B)', () => {
  it('is the gain at dusk only, and exactly 1 on every other light and when switched off', () => {
    expect(teamRingGain('dusk')).toBe(1.8);
    expect(teamRingGain('dusk', true)).toBe(1.8);
    expect(teamRingGain('dusk', false)).toBe(1);
    expect(teamRingGain('day')).toBe(1);
    expect(teamRingGain('dawn')).toBe(1);
  });

  it('never blooms: core alpha x the brightest team colour in ANY colour-vision variant x the gain stays under the ceiling', () => {
    // Falsified: duskTeamRing 2.5 puts the deuteranopia/protanopia neutral (#F0E442, luminance 0.744) at 0.55 x 0.744 x
    // 2.5 = 1.02 and this goes red; so does a ceiling at or over the bloom threshold.
    const team = palette.reserved.team as unknown as { colors: Record<string, string>; variants: Record<string, Record<string, string>> };
    const ringHexes = [team.colors, ...Object.values(team.variants)].flatMap((set) => [set.kedem, set.hostile, set.neutral]);
    expect(ringHexes.length).toBeGreaterThanOrEqual(12);
    const brightest = Math.max(...ringHexes.map(luminanceOf));
    expect(brightest).toBeGreaterThan(0.7); // the yellow neutral: the scan reads the real palette
    expect(TEAM_RING.coreAlpha * brightest * HDR_GAINS.duskTeamRing).toBeLessThan(DUSK_RING_COMPOSITE_CEILING);
    expect(DUSK_RING_COMPOSITE_CEILING).toBeLessThan(BLOOM_THRESHOLD);
  });
});
