import { describe, expect, it } from 'vitest';
import { buildingFitScale, FIT_MAX_ANISOTROPY } from './building-fit';

// Literals, not imports from the code under test: the house and apartment
// plans are the GLB bounds measured at MESH_SCALE (PR #440's table).
const HOUSE = [4.26, 3.71] as const;
const APARTMENT = [4.92, 4.89] as const;

describe('buildingFitScale', () => {
  it('off is the shipped size on any plot', () => {
    expect(buildingFitScale(...HOUSE, 1, 1, 'off')).toEqual({ sx: 1, sy: 1, sz: 1 });
  });

  it('never grows a mesh smaller than its plot (concrete on a 3x3)', () => {
    for (const fit of ['uniform', 'clamped', 'stretch'] as const)
      expect(buildingFitScale(1.2, 1.77, 3, 3, fit)).toEqual({ sx: 1, sy: 1, sz: 1 });
  });

  it('leaves a per-tile run alone', () => {
    expect(buildingFitScale(1, 0.2, 1, 1, 'clamped', true)).toEqual({ sx: 1, sy: 1, sz: 1 });
  });

  it('uniform: one scale, the largest that fits', () => {
    const s = buildingFitScale(...HOUSE, 2, 2, 'uniform');
    expect(s.sx).toBeCloseTo(2 / 4.26, 6);
    expect(s.sy).toBe(s.sx);
    expect(s.sz).toBe(s.sx);
  });

  it('clamped: the plan never leaves the plot and never stretches past the cap', () => {
    for (const [mw, md] of [HOUSE, APARTMENT])
      for (let fw = 1; fw <= 6; fw++)
        for (let fd = 1; fd <= 6; fd++) {
          const s = buildingFitScale(mw, md, fw, fd, 'clamped');
          expect(mw * s.sx).toBeLessThanOrEqual(fw + 1e-9);
          expect(md * s.sz).toBeLessThanOrEqual(fd + 1e-9);
          expect(Math.max(s.sx, s.sz) / Math.min(s.sx, s.sz)).toBeLessThanOrEqual(FIT_MAX_ANISOTROPY + 1e-9);
          expect(s.sy).toBe(Math.min(s.sx, s.sz));
        }
  });

  it('clamped: a house on a 3x2 is widened past uniform, by the cap', () => {
    // uniform would be min(3/4.26, 2/3.71) = 0.539 on every axis: 2.30 x 2.00.
    const s = buildingFitScale(...HOUSE, 3, 2, 'clamped');
    expect(s.sz).toBeCloseTo(2 / 3.71, 6);
    expect(s.sy).toBeCloseTo(2 / 3.71, 6);
    expect(s.sx).toBeCloseTo((2 / 3.71) * 1.25, 6);
    expect(4.26 * s.sx).toBeCloseTo(2.87, 2);
  });

  it('stretch: the plan fills the plot exactly', () => {
    const s = buildingFitScale(...HOUSE, 3, 2, 'stretch');
    expect(4.26 * s.sx).toBeCloseTo(3, 6);
    expect(3.71 * s.sz).toBeCloseTo(2, 6);
  });
});
