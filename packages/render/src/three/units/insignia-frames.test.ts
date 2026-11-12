/**
 * GH-1096 S1 and S2, gate 1 (presence): the generated insignia table holds exactly the approved scope.
 *
 * The scope is a LITERAL list here, never imported from the table it checks, and its count is pinned, so an empty table cannot
 * pass vacuously. S1 was the Lavi pilot; S2 adds the rest of the ground fleet (spec section 6.1, 12 ids in all); S3 grows it to the
 * 15 of section 6 with the aircraft. Falsify: delete any entry (or the whole table body), and this goes red.
 */
import { describe, expect, it } from 'vitest';
import { INSIGNIA_FRAMES, insigniaFrameOf } from './insignia-frames';

/**
 * The approved scope (GH-1096 decision 1, S1 + S2: the ground fleet) and each id's diameter, decision 10's numbers, never larger:
 * 0.60 standard, the Remetz 0.55, the D9, both Te'o, the Eitan and the jeep 0.50, the Namer 0.45, the Shachaf 0.40.
 */
const SIZES: Readonly<Record<string, number>> = {
  mbt_lavi: 0.6,
  officer_armour: 0.6,
  apc_kipod: 0.6,
  demo_tzav: 0.6,
  aa_remetz: 0.55,
  dozer_d9: 0.5,
  spg_long_range: 0.5,
  spg_cluster: 0.5,
  apc_eitan: 0.5,
  jeep_shoded: 0.5,
  ifv_namer: 0.45,
  scout_shachaf: 0.4,
};
const SCOPE = Object.keys(SIZES);

describe('gate 1: the insignia table holds the approved scope', () => {
  it('one frame per scoped id, and nothing else: the count is pinned', () => {
    expect(Object.keys(INSIGNIA_FRAMES).sort()).toEqual([...SCOPE].sort());
    expect(Object.keys(INSIGNIA_FRAMES)).toHaveLength(12);
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

  it('each diameter is decision 10\'s, exactly', () => {
    for (const id of SCOPE) expect(insigniaFrameOf(id)?.d, id).toBe(SIZES[id]);
  });

  it('the Lavi\'s approved numbers (spec section 6.1): 0.60 m at (0.95, 1.00) on the forward skirt panel', () => {
    const f = insigniaFrameOf('mbt_lavi');
    expect(f?.d).toBe(0.6);
    expect(f?.centre.slice(0, 2)).toEqual([0.95, 1.0]);
  });

  it('is looked up EXACTLY: the Ambush Tank (same hull), a seat-keyed template and a stranger get none', () => {
    for (const id of ['mbt_lavi_camo', 'mbt_lavi#s1', 'jeep_shoded#s1', 'MBT_LAVI', 'toString', '__proto__']) {
      expect(insigniaFrameOf(id), id).toBeNull();
    }
  });

  it('decisions 2 and 3: the drones, the UGV, the Ambush Tank and the two medical vehicles are never marked', () => {
    for (const id of ['attack_drone', 'recon_drone', 'ugv_recon_dog', 'mbt_lavi_camo', 'veh_ambulance', 'air_medevac_heli']) {
      expect(insigniaFrameOf(id), id).toBeNull();
    }
  });
});
