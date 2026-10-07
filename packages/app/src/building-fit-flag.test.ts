import { describe, expect, it } from 'vitest';
import { buildingFitOf } from './building-fit-flag';

const of = (q: string) => buildingFitOf(new URLSearchParams(q));

describe('buildingFitOf', () => {
  it('is off when the flag is absent', () => {
    expect(of('mission=beit_sahwan_3_clearance')).toEqual({ value: 'off', warning: null });
  });
  it('reads a bare flag as the recommended clamped rule', () => {
    expect(of('fitbuildings')).toEqual({ value: 'clamped', warning: null });
    expect(of('fitbuildings=1')).toEqual({ value: 'clamped', warning: null });
  });
  it('takes each named rule', () => {
    for (const v of ['off', 'uniform', 'clamped', 'stretch']) expect(of(`fitbuildings=${v}`).value).toBe(v);
  });
  it('falls back to the shipped size on a typo, and names it', () => {
    const r = of('fitbuildings=clampd');
    expect(r.value).toBe('off');
    expect(r.warning).toContain('clampd');
  });
});
