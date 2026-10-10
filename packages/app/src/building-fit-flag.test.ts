import { describe, expect, it } from 'vitest';
import { buildingFitOf } from './building-fit-flag';

const of = (q: string) => buildingFitOf(new URLSearchParams(q));

describe('buildingFitOf', () => {
  it('leaves the renderer its own default when the flag is absent', () => {
    expect(of('mission=beit_sahwan_3_clearance')).toEqual({ value: undefined, warning: null });
  });
  it('reads a bare flag as stretch, the shipped rule', () => {
    expect(of('fitbuildings')).toEqual({ value: 'stretch', warning: null });
    expect(of('fitbuildings=1')).toEqual({ value: 'stretch', warning: null });
  });
  it('takes each named rule, off included', () => {
    for (const v of ['off', 'uniform', 'clamped', 'stretch']) expect(of(`fitbuildings=${v}`).value).toBe(v);
  });
  it('falls back to the default on a typo, and names it', () => {
    const r = of('fitbuildings=stretchh');
    expect(r.value).toBeUndefined();
    expect(r.warning).toContain('stretchh');
  });
});
