import { describe, expect, it } from 'vitest';
import { DEFAULT_BUILDING_FIT, FIT_MAX_ANISOTROPY, buildingFitScale, fitDistortion } from './building-fit';

// Literals, not imports from the code under test: the plans and heights are
// the GLB bounds measured at MESH_SCALE (PR #440's table).
const HOUSE = [4.26, 3.71, 4.24] as const;
const APARTMENT = [4.92, 4.89, 7.74] as const;
const WAREHOUSE = [4.0, 4.0, 1.4] as const;

describe('buildingFitScale', () => {
  it('the default is stretch, the lead ruling of 7 Oct', () => {
    expect(DEFAULT_BUILDING_FIT).toBe('stretch');
  });

  it('off is the shipped size on any plot', () => {
    expect(buildingFitScale(...HOUSE, 1, 1, 'off')).toEqual({ sx: 1, sy: 1, sz: 1 });
  });

  it('never grows a mesh smaller than its plot (concrete on a 3x3)', () => {
    for (const fit of ['uniform', 'clamped', 'stretch'] as const)
      expect(buildingFitScale(1.2, 1.77, 3.0, 3, 3, fit)).toEqual({ sx: 1, sy: 1, sz: 1 });
  });

  it('leaves a per-tile run alone', () => {
    expect(buildingFitScale(1, 0.2, 0.47, 1, 1, 'stretch', true)).toEqual({ sx: 1, sy: 1, sz: 1 });
  });

  it('stretch: the plan fills the plot exactly, height follows the smaller plan scale', () => {
    const s = buildingFitScale(...HOUSE, 3, 2, 'stretch');
    expect(4.26 * s.sx).toBeCloseTo(3, 6);
    expect(3.71 * s.sz).toBeCloseTo(2, 6);
    expect(s.sy).toBeCloseTo(2 / 3.71, 6);
  });

  it('stretch never distorts past 2x when a plan axis is what runs long (a house on a 7x1)', () => {
    const s = buildingFitScale(...HOUSE, 7, 1, 'stretch');
    // Uncapped: sx 1, sz 1/3.71 = 0.270 -> 3.7x. Capped: sx = 2 x 0.270.
    expect(fitDistortion(s)).toBeCloseTo(2, 6);
    expect(4.26 * s.sx).toBeCloseTo((2 * 4.26) / 3.71, 6);
    for (let fw = 1; fw <= 8; fw++)
      for (let fd = 1; fd <= 8; fd++)
        for (const [mw, md, mh] of [HOUSE, APARTMENT])
          expect(fitDistortion(buildingFitScale(mw, md, mh, fw, fd, 'stretch'))).toBeLessThanOrEqual(2 + 1e-9);
  });

  it('nothing fitted draws under 1.2 world units, over its shipped height, or off its plot', () => {
    for (const [mw, md, mh] of [HOUSE, APARTMENT, WAREHOUSE])
      for (let fw = 1; fw <= 6; fw++)
        for (let fd = 1; fd <= 6; fd++)
          for (const fit of ['uniform', 'clamped', 'stretch'] as const) {
            const s = buildingFitScale(mw, md, mh, fw, fd, fit);
            expect(mh * s.sy).toBeGreaterThanOrEqual(1.2 - 1e-9);
            expect(s.sy).toBeLessThanOrEqual(1);
            expect(mw * s.sx).toBeLessThanOrEqual(fw + 1e-9);
            expect(md * s.sz).toBeLessThanOrEqual(fd + 1e-9);
          }
  });

  it('the floor keeps a warehouse on a 2x1 taller than a rifleman (0.56), and no clamp can cure that plot', () => {
    const s = buildingFitScale(...WAREHOUSE, 2, 1, 'stretch');
    // Without the floor: min(2/4, 1/4) = 0.25 -> 0.35 world units.
    expect(1.4 * s.sy).toBeCloseTo(1.2, 6);
    // The FLOOR is 3.4x the depth scale: the one case clause 5 leaves to the
    // map author (building_fit_census.test.ts keeps every campaign plot <= 2).
    expect(fitDistortion(s)).toBeCloseTo(1.2 / 1.4 / 0.25, 5);
  });

  it('a house on a 1x1 stands at 1.2, not at its plan scale (1.0)', () => {
    const s = buildingFitScale(...HOUSE, 1, 1, 'stretch');
    expect(4.24 * s.sy).toBeCloseTo(1.2, 6);
  });

  it('clamped caps the plan anisotropy at 1.25', () => {
    const s = buildingFitScale(...HOUSE, 3, 2, 'clamped');
    expect(s.sx / s.sz).toBeCloseTo(FIT_MAX_ANISOTROPY, 6);
  });

  it('uniform keeps one plan scale', () => {
    const s = buildingFitScale(...HOUSE, 2, 2, 'uniform');
    expect(s.sx).toBe(s.sz);
    expect(s.sx).toBeCloseTo(2 / 4.26, 6);
  });
});
