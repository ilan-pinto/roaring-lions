// The sandbox task force as a ROSTER: which unit types a given set of flags
// will put on the map.
//
// `sandboxUnitTypes` is what the mesh loader asks before the renderer exists.
// A type placed but absent from the roster is the `SPRITE_MAP` failure mode --
// art that ships, passes every gate, and draws nothing -- and for `civilians`
// it is worse than for anything else: that type has no billboard to fall back
// on, so a miss is an invisible crowd rather than a sprite where a model
// should be.
import { describe, expect, it } from 'vitest';
import {
  SANDBOX_CIV,
  SANDBOX_ENEMY,
  SANDBOX_KDF,
  SANDBOX_SUR,
  SANDBOX_TUNNEL_KDF,
  sandboxUnitTypes,
} from './sandbox-force';
import { RIGGED_UNIT_MESHES } from './mesh-catalogue';

const NONE = { tunnel: false, sur: false, civ: false };

describe('sandboxUnitTypes', () => {
  it('names every type the base tables place, with no flags at all', () => {
    const got = sandboxUnitTypes(NONE);
    for (const [id] of [...SANDBOX_KDF, ...SANDBOX_ENEMY]) expect(got.has(id)).toBe(true);
  });

  it('adds civilians only for &civ', () => {
    expect(sandboxUnitTypes(NONE).has('civilians')).toBe(false);
    expect(sandboxUnitTypes({ ...NONE, tunnel: true, sur: true }).has('civilians')).toBe(false);
    expect(sandboxUnitTypes({ ...NONE, civ: true }).has('civilians')).toBe(true);
  });

  it('reads the same arrays the spawner iterates, for every flag', () => {
    // The one property that makes a fifth hand-kept list unnecessary.
    const all = sandboxUnitTypes({ tunnel: true, sur: true, civ: true });
    for (const [id] of [
      ...SANDBOX_KDF,
      ...SANDBOX_ENEMY,
      ...SANDBOX_TUNNEL_KDF,
      ...SANDBOX_SUR,
      ...SANDBOX_CIV,
    ]) {
      expect(all.has(id)).toBe(true);
    }
  });
});

describe('the &civ crowd', () => {
  it('is civilians and nothing else', () => {
    expect([...new Set(SANDBOX_CIV.map(([id]) => id))]).toEqual(['civilians']);
  });

  it('is a whole number of variant rotations, so no figure appears more often', () => {
    // `pickMeshVariant` is `entityId % variants.length` and the crowd takes a
    // contiguous id block, so the count decides the spread. Eight over four
    // figures is two apiece. A count that is not a multiple would show one
    // figure more often than the rest -- the artifact the four variants exist
    // to remove -- and this goes red both if the crowd is resized and if a
    // fifth figure ships.
    const variants = RIGGED_UNIT_MESHES.civilians.files.length;
    expect(variants).toBeGreaterThan(1);
    expect(SANDBOX_CIV.length % variants).toBe(0);
    expect(SANDBOX_CIV.length / variants).toBe(2);
  });

  it('stands in two clusters, not one line', () => {
    // A row of eight is the one arrangement in which "all four figures, twice"
    // is hard to see at a glance.
    const ys = SANDBOX_CIV.map(([, , dy]) => dy);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(4);
    expect(new Set(SANDBOX_CIV.map(([, dx, dy]) => `${dx},${dy}`)).size).toBe(SANDBOX_CIV.length);
  });
});
