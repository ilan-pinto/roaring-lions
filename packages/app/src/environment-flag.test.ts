import { describe, expect, it } from 'vitest';
import { environmentLightOf } from './environment-flag';
import { KNOWN_PARAMS, unknownParams } from './sandbox-help';

const of = (q: string) => environmentLightOf(new URLSearchParams(q));

describe('environmentLightOf', () => {
  it('is ON when the flag is absent: L1 shipped on 2 Nov', () => {
    expect(of('')).toBe(true);
    expect(of('sandbox=tel_marum&tod=dusk')).toBe(true);
  });
  it('reads a bare flag and =1 as on', () => {
    expect(of('envlight')).toBe(true);
    expect(of('envlight=1')).toBe(true);
  });
  it('lets a bookmark spell it off, for an A/B against the pre-L1 frame', () => {
    for (const v of ['0', 'off', 'false']) expect(of(`envlight=${v}`)).toBe(false);
  });
  it('is a known parameter, so it is not reported as a typo', () => {
    expect(KNOWN_PARAMS.map((p) => p.name)).toContain('envlight');
    expect(unknownParams(new URLSearchParams('sandbox=tel_marum&envlight'))).toEqual([]);
  });
});
