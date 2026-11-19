import { describe, expect, it } from 'vitest';
import { DUSK_READ_DEFAULT, duskReadOf } from './dusk-read-flag';
import { KNOWN_PARAMS, unknownParams } from './sandbox-help';

const of = (q: string) => duskReadOf(new URLSearchParams(q));

describe('duskReadOf (GH-1403)', () => {
  it('is OFF when the flag is absent: held for the lead, so no gated frame moves', () => {
    expect(DUSK_READ_DEFAULT).toBe(false);
    expect(of('')).toBe(false);
    expect(of('sandbox=wadi_halam_basin&tod=dusk')).toBe(false);
  });
  it('reads a bare flag, =1, =on and =true as on', () => {
    for (const q of ['duskread', 'duskread=1', 'duskread=on', 'duskread=true']) expect(of(q)).toBe(true);
  });
  it('reads =0, =off and =false as off, and anything else as the default', () => {
    for (const q of ['duskread=0', 'duskread=off', 'duskread=false']) expect(of(q)).toBe(false);
    expect(of('duskread=maybe')).toBe(DUSK_READ_DEFAULT);
  });
  it('is a known parameter, so it is not reported as a typo', () => {
    expect(KNOWN_PARAMS.map((p) => p.name)).toContain('duskread');
    expect(unknownParams(new URLSearchParams('sandbox=wadi_halam_basin&tod=dusk&duskread'))).toEqual([]);
  });
});
