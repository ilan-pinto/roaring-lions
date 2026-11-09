import { describe, expect, it } from 'vitest';
import { BANDS, parityVerdict, ratioOf } from './parity';
import { PARITY_ROWS } from './parity-bands';

const d = (mean: number, px = 0) => ({ meanAbsChannelDelta: mean, changedPixels: px });

describe('parityVerdict', () => {
  it('a stubbed delta of 0 reads FAIL on every ratio band (a layer that moves nothing is not in parity)', () => {
    for (const b of ['tight', 'loose', 'ao'] as const) {
      expect(parityVerdict(BANDS[b], d(0), d(2)).ok, `${b}: node 0`).toBe(false);
      expect(parityVerdict(BANDS[b], d(2), d(0)).ok, `${b}: legacy 0`).toBe(false);
      expect(parityVerdict(BANDS[b], d(0), d(0)).ok, `${b}: both 0`).toBe(false);
    }
  });
  it('the zero band accepts exactly 0 on both arms and nothing else', () => {
    expect(parityVerdict(BANDS.zero, d(0), d(0)).ok).toBe(true);
    expect(parityVerdict(BANDS.zero, d(0.0001), d(0)).ok).toBe(false);
    expect(parityVerdict(BANDS.zero, d(0, 1), d(0)).ok).toBe(false);
    expect(parityVerdict(BANDS.zero, d(0), d(0, 1)).ok).toBe(false);
  });
  it('bands are inclusive at their edges and exclusive just outside', () => {
    expect(parityVerdict(BANDS.tight, d(0.95), d(1)).ok).toBe(true);
    expect(parityVerdict(BANDS.tight, d(1.05), d(1)).ok).toBe(true);
    expect(parityVerdict(BANDS.tight, d(0.9499), d(1)).ok).toBe(false);
    expect(parityVerdict(BANDS.tight, d(1.0501), d(1)).ok).toBe(false);
    expect(parityVerdict(BANDS.loose, d(1.15), d(1)).ok).toBe(true);
    expect(parityVerdict(BANDS.loose, d(1.16), d(1)).ok).toBe(false);
    expect(parityVerdict(BANDS.ao, d(0.7), d(1)).ok).toBe(true);
    expect(parityVerdict(BANDS.ao, d(1.31), d(1)).ok).toBe(false);
  });
  it('the bands are the plan values, verbatim', () => {
    expect(BANDS.tight).toEqual({ kind: 'ratio', lo: 0.95, hi: 1.05 });
    expect(BANDS.loose).toEqual({ kind: 'ratio', lo: 0.85, hi: 1.15 });
    expect(BANDS.ao).toEqual({ kind: 'ratio', lo: 0.7, hi: 1.3 });
    expect(BANDS.exact).toEqual({ kind: 'exact', maxDelta: 1 });
  });
  it('exact: within 1/255 of a channel (1 on the 0..255 scale)', () => {
    expect(parityVerdict(BANDS.exact, d(3.9), d(3)).ok).toBe(true);
    expect(parityVerdict(BANDS.exact, d(4.1), d(3)).ok).toBe(false);
  });
  it('NaN, infinite and negative readings fail rather than pass by comparison accident', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      expect(parityVerdict(BANDS.loose, d(bad), d(1)).ok).toBe(false);
      expect(parityVerdict(BANDS.zero, d(0), d(bad)).ok).toBe(false);
    }
  });
  it('the secondary metric is reported but never votes', () => {
    const v = parityVerdict(BANDS.tight, d(1, 1000), d(1, 10));
    expect(v.ok).toBe(true);
    expect(v.pixelRatio).toBe(100);
  });
  it('ratioOf is null, not 0 or Infinity, when the divisor is 0', () => {
    expect(ratioOf(3, 0)).toBeNull();
    expect(ratioOf(0, 3)).toBe(0);
  });
});

describe('PARITY_ROWS', () => {
  it('is non-empty, unique per (scenario, layer), and every r0 starts unread', () => {
    expect(PARITY_ROWS.length).toBeGreaterThan(0);
    const keys = PARITY_ROWS.map((r) => `${r.scenario}/${r.layer}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
