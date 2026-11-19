import { describe, expect, it } from 'vitest';
import { playWorks, worksMain } from './versus-works';
import { seedOf } from './versus-probe';

// The field-works arm of the versus probe (report-only). What the table rests on: the ON arm really raises works on both
// sides and the OFF arm has no runtime and raises none, and the table's own self-check passes on a short run.
describe('versus probe: the field-works arm', () => {
  it('on: both sides complete works from their own purse; off: none', () => {
    const on = playWorks('tel_marum', seedOf(0), true);
    expect(on.completed[0]).toBeGreaterThan(0);
    expect(on.completed[1]).toBeGreaterThan(0);
    expect(on.purse[0]).toBeLessThan(1000);
    expect(on.purse[1]).toBeLessThan(1000);
    const off = playWorks('tel_marum', seedOf(0), false);
    expect(off.completed).toEqual([0, 0]);
    expect(off.purse).toEqual([-1, -1]);
  });

  it('one seed played twice is one game', () => {
    expect(playWorks('milh_flats', seedOf(3), true)).toEqual(playWorks('milh_flats', seedOf(3), true));
  });

  it('the table exits 0 on a short run', () => {
    expect(worksMain(['--field-works', '--seeds=1', '--maps=tel_marum'])).toBe(0);
  });
});
