import { describe, it, expect } from 'vitest';
import { decorPlacements, VARIANTS_PER_FAMILY } from './decor-place';
import { DECOR_GROVE, DECOR_KNOLL, DECOR_RIDGE, DECOR_ROAD, WORLD_PER_LEVEL } from './shared';
import type { TerrainInput } from './types';

/** A w*h map, everything open ground, with per-tile overrides applied after. */
function input(w: number, h: number, edit?: (i: TerrainInput, decor: Uint8Array, blocked: Uint8Array, cover: Uint8Array) => void): TerrainInput {
  const decor = new Uint8Array(w * h);
  const blocked = new Uint8Array(w * h);
  const cover = new Uint8Array(w * h);
  const t: TerrainInput = {
    width: w,
    height: h,
    decor,
    elevation: null,
    blocked,
    cover,
  };
  edit?.(t, decor, blocked, cover);
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
      input(8, 8, (_t, decor) => decor.fill(DECOR_ROAD))
    );
    expect(out).toEqual([]);
  });

  it('puts trees on grove tiles, rocks on knolls, slabs on ridges', () => {
    const families = (decorValue: number): Set<string> => {
      const out = decorPlacements(input(10, 10, (_t, decor) => decor.fill(decorValue)));
      return new Set(out.map((p) => p.family));
    };
    expect(families(DECOR_GROVE)).toEqual(new Set(['tree']));
    expect(families(DECOR_KNOLL)).toEqual(new Set(['rock']));
    expect(families(DECOR_RIDGE)).toEqual(new Set(['slab']));
  });

  it('puts bushes directly on cover tiles with no decor value', () => {
    // Verify that a plain cover > 0 tile (with decor = 0) yields family === 'bush'
    const out = decorPlacements(
      input(8, 8, (_t, _decor, _blocked, cover) => cover.fill(1))
    );
    const families = new Set(out.map((p) => p.family));
    expect(families).toEqual(new Set(['bush']));
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
    expect(flat[0].y).toBe(0);
    expect(raised[0].y).toBe(4 * WORLD_PER_LEVEL);
  });
});
