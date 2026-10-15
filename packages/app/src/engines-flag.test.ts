import { describe, expect, it } from 'vitest';
import { enginesOf } from './engines-flag';

const q = (s: string): URLSearchParams => new URLSearchParams(s);

describe('enginesOf (GH-35)', () => {
  it('the sandbox reads &engines=a and &engines=b', () => {
    expect(enginesOf(null, q('?engines=a'))).toEqual({ value: 'a', warning: null });
    expect(enginesOf(null, q('?engines=b'))).toEqual({ value: 'b', warning: null });
  });

  it('absent means the data pick', () => {
    expect(enginesOf(null, q(''))).toEqual({ value: null, warning: null });
  });

  it('a mission never reads the flag: it plays the data picks', () => {
    expect(enginesOf({ map: {} }, q('?engines=b'))).toEqual({ value: null, warning: null });
  });

  it('an unknown value falls back to the data pick and names itself', () => {
    const r = enginesOf(null, q('?engines=c'));
    expect(r.value).toBeNull();
    expect(r.warning).toContain('"c"');
  });
});
