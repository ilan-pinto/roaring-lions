import { fx, type HitFactors, type HitProjection } from '@lions/sim';
import { describe, expect, it } from 'vitest';
import { fireState } from './fire-state';

const factors = (o: Partial<Record<keyof HitFactors, number>> = {}): HitFactors => ({
  p: fx.from(o.p ?? 0.5),
  accuracy: fx.from(o.accuracy ?? 0.6),
  rangeFalloff: fx.from(o.rangeFalloff ?? 1),
  coverMod: fx.from(o.coverMod ?? 1),
  motionMod: fx.from(o.motionMod ?? 1),
  stanceMod: fx.from(o.stanceMod ?? 1),
  suppressionMod: fx.from(o.suppressionMod ?? 1),
});
const shot = (p: number, f: Partial<Record<keyof HitFactors, number>> = {}): HitProjection => ({
  kind: 'shot',
  weaponId: 'rifles',
  pHit: fx.from(p),
  hurts: true,
  factors: factors(f),
});

describe('fireState', () => {
  it('says nothing for an empty selection', () => {
    expect(fireState([])).toBeNull();
  });
  it('names cover when the ground costs the shot anything', () => {
    expect(fireState([shot(0.1, { coverMod: 0.14 })])).toBe('cover');
  });
  it('names motion when the target is moving in the open', () => {
    expect(fireState([shot(0.3, { motionMod: 0.6 })])).toBe('moving');
  });
  it('cover outranks motion on the same shot', () => {
    expect(fireState([shot(0.1, { coverMod: 0.4, motionMod: 0.6 })])).toBe('cover');
  });
  it('a clean shot is a shot, whatever the range costs', () => {
    expect(fireState([shot(0.4, { rangeFalloff: 0.5 })])).toBe('shot');
  });
  it('describes the BEST shot in the selection', () => {
    expect(fireState([shot(0.05, { coverMod: 0.2 }), shot(0.5, { motionMod: 0.6 })])).toBe('moving');
  });
  it('any shot beats an unidentified or blocked neighbour', () => {
    expect(fireState([{ kind: 'unidentified' }, { kind: 'noSolution' }, shot(0.5)])).toBe('shot');
  });
  it('unidentified outranks holding and out-of-reach', () => {
    expect(fireState([{ kind: 'noSolution' }, { kind: 'holdingFire' }, { kind: 'unidentified' }])).toBe('unidentified');
  });
  it('holding outranks out-of-reach', () => {
    expect(fireState([{ kind: 'noSolution' }, { kind: 'holdingFire' }])).toBe('holding');
  });
  it('nothing but noSolution is out of reach', () => {
    expect(fireState([{ kind: 'noSolution' }, { kind: 'noSolution' }])).toBe('out_of_reach');
  });
});
