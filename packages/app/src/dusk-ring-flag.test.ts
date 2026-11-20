import { describe, expect, it } from 'vitest';
import { duskTeamRingOf } from './dusk-ring-flag';
import { KNOWN_PARAMS, unknownParams } from './sandbox-help';

const of = (q: string) => duskTeamRingOf(new URLSearchParams(q));

describe('duskTeamRingOf (GH-1403, option B)', () => {
  it('is ON when the flag is absent, bare or =1: the lead\'s proposed default at dusk', () => {
    for (const q of ['', 'sandbox=wadi_halam_4&tod=dusk', 'duskring', 'duskring=1']) expect(of(q)).toBe(true);
  });
  it('lets a bookmark spell it off, for an A/B against today\'s ring', () => {
    for (const v of ['0', 'off', 'false']) expect(of(`duskring=${v}`)).toBe(false);
  });
  it('is a known parameter, so it is not reported as a typo', () => {
    expect(KNOWN_PARAMS.map((p) => p.name)).toContain('duskring');
    expect(unknownParams(new URLSearchParams('sandbox=wadi_halam_4&tod=dusk&duskring=0'))).toEqual([]);
  });
});
