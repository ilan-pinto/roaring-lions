// The role buckets the cursor and the inspect card share.
//
// hud.ts had this rung inline. The cursor needs the same answer, and two
// copies would let the cursor call a unit a transport while the card beside
// it says soft. One classifier, two callers -- the same reasoning as
// zoneContains in the slice before this one.
import { describe, expect, it } from 'vitest';
import { ROLE_GLYPH, roleBucket, type RoleBucket } from './role';

/** The four fields the classifier reads, defaulted to an armour unit. */
function unit(over: Partial<Parameters<typeof roleBucket>[0]> = {}) {
  return { isKamikaze: false, role: 'mbt', transportSlots: 0, isSoft: false, ...over };
}

describe('roleBucket', () => {
  it('puts kamikaze first, above everything it also is', () => {
    // attack_drone is BOTH kamikaze and a drone. The rung order decides, and
    // kamikaze is the more urgent fact about a unit you are about to spend.
    expect(roleBucket(unit({ isKamikaze: true, role: 'drone' }))).toBe('kamikaze');
  });

  it('buckets a drone, a gunship and a sniper by role', () => {
    expect(roleBucket(unit({ role: 'drone' }))).toBe('drone');
    expect(roleBucket(unit({ role: 'gunship' }))).toBe('gunship');
    expect(roleBucket(unit({ role: 'sniper' }))).toBe('sniper');
  });

  it('calls anything with transport slots a transport', () => {
    expect(roleBucket(unit({ role: 'apc', transportSlots: 2 }))).toBe('transport');
  });

  it('puts transport above soft, so a carrier is not merely infantry', () => {
    expect(roleBucket(unit({ role: 'apc', transportSlots: 2, isSoft: true }))).toBe('transport');
  });

  it('calls a soft unit with no slots soft, and everything else armour', () => {
    expect(roleBucket(unit({ role: 'infantry', isSoft: true }))).toBe('soft');
    expect(roleBucket(unit({ role: 'mbt' }))).toBe('armour');
  });

  it('gives every bucket a glyph', () => {
    const buckets: RoleBucket[] = [
      'kamikaze', 'drone', 'gunship', 'sniper', 'transport', 'soft', 'armour',
    ];
    for (const b of buckets) expect(ROLE_GLYPH[b]).toBeTruthy();
  });
});
