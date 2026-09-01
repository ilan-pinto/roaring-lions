import { describe, it, expect } from 'vitest';
import { decorPlacements, VARIANTS_PER_FAMILY } from './decor-place';
import { DECOR_GROVE, DECOR_KNOLL, DECOR_RIDGE, DECOR_ROAD } from './shared';
import type { TerrainInput } from './types';

/** A w*h map, everything open ground, with per-tile overrides applied after. */
function input(w: number, h: number, edit?: (i: TerrainInput) => void): TerrainInput {
  const t: TerrainInput = {
    width: w,
    height: h,
    decor: new Uint8Array(w * h),
    elevation: null,
    blocked: new Uint8Array(w * h),
    cover: new Uint8Array(w * h),
  };
  edit?.(t);
  return t;
}

describe('decorPlacements', () => {
  it('is deterministic: the same map twice gives an identical list', () => {
    // Appearance determinism is the whole reason this uses tileHash and not
    // Math.random -- two runs that merely both look scattered would make every
    // screenshot comparison noise.
    const a = decorPlacements(input(12, 12));
    const b = decorPlacements(input(12, 12));
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(0);
  });

  it('never places anything on a blocked tile', () => {
    // A rock inside a building is a bug report, and the building box is drawn
    // over the same ground.
    const out = decorPlacements(
      input(8, 8, (t) => t.blocked.fill(1))
    );
    expect(out).toEqual([]);
  });

  it('never places anything on a road', () => {
    const out = decorPlacements(
      input(8, 8, (t) => t.decor!.fill(DECOR_ROAD))
    );
    expect(out).toEqual([]);
  });

  it('puts trees on grove tiles, rocks on knolls, slabs on ridges', () => {
    const families = (decorValue: number): Set<string> => {
      const out = decorPlacements(input(10, 10, (t) => t.decor!.fill(decorValue)));
      return new Set(out.map((p) => p.family));
    };
    expect(families(DECOR_GROVE)).toEqual(new Set(['tree']));
    expect(families(DECOR_KNOLL)).toEqual(new Set(['rock']));
    expect(families(DECOR_RIDGE)).toEqual(new Set(['slab']));
  });

  it('puts bushes on cover tiles and gets denser with the cover level', () => {
    const count = (cover: number): number =>
      decorPlacements(input(16, 16, (t) => t.cover.fill(cover))).length;
    expect(count(3)).toBeGreaterThan(count(1));
  });

  it('keeps every variant index inside the family range', () => {
    for (const p of decorPlacements(input(20, 20))) {
      expect(p.variant).toBeGreaterThanOrEqual(0);
      expect(p.variant).toBeLessThan(VARIANTS_PER_FAMILY);
    }
  });

  it('sits a placement on its own tile top, not at elevation zero', () => {
    // Same property scatter.test.ts already proves for flat marks: a mark on
    // raised ground must rise with it or it sinks into the hill.
    const flat = decorPlacements(input(6, 6));
    const raised = decorPlacements(
      input(6, 6, (t) => {
        t.elevation = new Uint8Array(36).fill(4);
      })
    );
    expect(raised[0].y).toBeGreaterThan(flat[0].y);
  });
});
