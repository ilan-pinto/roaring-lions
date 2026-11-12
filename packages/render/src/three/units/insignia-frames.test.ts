/**
 * GH-1096 S1, gate 1 (presence): the generated insignia table holds exactly the approved scope.
 *
 * The scope is a LITERAL list here, never imported from the table it checks, and its count is pinned, so an empty table cannot
 * pass vacuously. S1 is the Lavi pilot alone; S2 and S3 grow this list to the 15 ids of the spec's section 6, one entry at a time,
 * each approved on its own garage sheet. Falsify: delete `mbt_lavi`'s entry (or the whole table body), and this goes red.
 */
import { describe, expect, it } from 'vitest';
import { INSIGNIA_FRAMES, insigniaFrameOf } from './insignia-frames';

/** The approved scope (GH-1096 S1): the pilot. */
const SCOPE = ['mbt_lavi'] as const;

describe('gate 1: the insignia table holds the approved scope', () => {
  it('one frame per scoped id, and nothing else: the count is pinned', () => {
    expect(Object.keys(INSIGNIA_FRAMES).sort()).toEqual([...SCOPE].sort());
    expect(Object.keys(INSIGNIA_FRAMES)).toHaveLength(1);
  });

  it('each frame is a real placement: a 0.30-0.60 m disc, a non-empty slab, a flank normal test, a positive luma, a hash', () => {
    for (const id of SCOPE) {
      const f = insigniaFrameOf(id);
      expect(f, id).not.toBeNull();
      if (f === null) continue;
      expect(f.d).toBeGreaterThanOrEqual(0.3);
      expect(f.d).toBeLessThanOrEqual(0.6); // decision 10: never larger than 0.60 m
      expect(f.slab[0]).toBeLessThan(f.slab[1]);
      expect(f.slab[0]).toBeGreaterThan(0); // a flank pair, mirrored: never across the centreline
      expect(Math.abs(f.centre[2])).toBeGreaterThanOrEqual(f.slab[0]);
      expect(Math.abs(f.centre[2])).toBeLessThanOrEqual(f.slab[1]);
      expect(f.min_n).toBeGreaterThanOrEqual(0.5);
      expect(f.luma).toBeGreaterThan(0.02);
      expect(f.host_sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('the Lavi\'s approved numbers (spec section 6.1): 0.60 m at (0.95, 1.00) on the forward skirt panel', () => {
    const f = insigniaFrameOf('mbt_lavi');
    expect(f?.d).toBe(0.6);
    expect(f?.centre.slice(0, 2)).toEqual([0.95, 1.0]);
  });

  it('is looked up EXACTLY: the variants that share the Lavi\'s hull, a seat-keyed template and a stranger get none', () => {
    for (const id of ['mbt_lavi_camo', 'officer_armour', 'mbt_lavi#s1', 'MBT_LAVI', 'toString', '__proto__', 'jeep_shoded']) {
      expect(insigniaFrameOf(id), id).toBeNull();
    }
  });
});
