import { describe, it, expect } from 'vitest';
import { decorPlacements, VARIANTS_PER_FAMILY } from './decor-place';
import { DECOR_GROVE, DECOR_KNOLL, DECOR_RIDGE, DECOR_ROAD, WORLD_PER_LEVEL } from './shared';
import { tileHash } from '../../tile-hash';
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

/** Same shape as `input`, plus a `boulder` layer -- kept separate rather than
 *  widening `input`'s own signature, since only the boulder tests below need
 *  it and every other test in this file must keep proving the field is
 *  genuinely optional (map.ts's own legend: a `b` tile is always
 *  blocked=0/decor=none/cover=0, so boulder is the ONLY layer these fixtures
 *  vary). */
function inputWithBoulder(w: number, h: number, boulder: Uint8Array): TerrainInput {
  return {
    width: w,
    height: h,
    decor: new Uint8Array(w * h),
    elevation: null,
    blocked: new Uint8Array(w * h),
    cover: new Uint8Array(w * h),
    boulder,
  };
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
    // Ridge is NOT a bare-decor override like grove/knoll: `map.ts`'s own
    // legend (`'^': { blocked: 1, cover: 0, decor: DECOR.ridge }`) makes
    // blocked=1 the one combination `parseMap` actually emits for it, so the
    // fixture must set `blocked` too -- decor=RIDGE with blocked=0 is a
    // shape the real decoder can never produce.
    const families = (decorValue: number, blockedToo = false): Set<string> => {
      const out = decorPlacements(
        input(10, 10, (_t, decor, blocked) => {
          decor.fill(decorValue);
          if (blockedToo) blocked.fill(1);
        })
      );
      return new Set(out.map((p) => p.family));
    };
    expect(families(DECOR_GROVE)).toEqual(new Set(['tree']));
    expect(families(DECOR_KNOLL)).toEqual(new Set(['rock']));
    expect(families(DECOR_RIDGE, true)).toEqual(new Set(['slab']));
  });

  it('gives a ridge tile (blocked 1 + decor ridge, the only shape parseMap emits) a slab', () => {
    // The critical-finding regression test: `decorPlacements` used to skip
    // EVERY blocked tile before `familyFor` was ever consulted, so this
    // branch was dead on every shipped map (Tel Marum alone is 748 ridge
    // tiles, 32% of the map). A ridge is the one blocked tile that is not a
    // building -- `buildings.ts`'s own doc comment says so explicitly, and
    // skips exactly it before ever asking whether a structure stands there.
    const out = decorPlacements(
      input(10, 10, (_t, decor, blocked) => {
        decor.fill(DECOR_RIDGE);
        blocked.fill(1);
      })
    );
    expect(out.length).toBeGreaterThan(0);
    expect(new Set(out.map((p) => p.family))).toEqual(new Set(['slab']));
  });

  it('still puts nothing on a blocked NON-ridge tile (a building: blocked 1, decor 0)', () => {
    // The other half of the same fix: a building's own footprint must stay
    // bare -- `buildBuildings`'s box already owns that ground entirely.
    const out = decorPlacements(
      input(10, 10, (_t, _decor, blocked) => blocked.fill(1))
    );
    expect(out).toEqual([]);
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

  describe('the grove twin tree (retiring buildGroves must not thin the canopy)', () => {
    // grove.ts's own twin rule: `tileHash(x * 3, y * 7) > 0.62`, second tree
    // at 0.68 scale. Retiring the procedural canopy (Task 7) means
    // decor-place.ts is now the ONLY source of grove trees, so it must
    // reproduce that rule itself rather than silently dropping to one tree
    // per tile everywhere. (0, 0) sits below the threshold (single tree),
    // (2, 0) sits above it (twin) -- the same two fixture coordinates
    // grove.test.ts already uses, picked by brute force over the real hash.
    const SINGLE_X = 0, SINGLE_Y = 0;
    const TWIN_X = 2, TWIN_Y = 0;

    it('the fixture coordinates actually straddle the twin threshold', () => {
      expect(tileHash(SINGLE_X * 3, SINGLE_Y * 7)).toBeLessThanOrEqual(0.62);
      expect(tileHash(TWIN_X * 3, TWIN_Y * 7)).toBeGreaterThan(0.62);
    });

    it('places exactly one tree below the threshold', () => {
      const out = decorPlacements(
        input(1, 1, (_t, decor) => {
          decor[SINGLE_Y * 1 + SINGLE_X] = DECOR_GROVE;
        })
      );
      expect(out.length).toBe(1);
      expect(out[0].family).toBe('tree');
    });

    it('places two trees above the threshold, the second at 0.68 the first\'s scale', () => {
      const w = TWIN_X + 1;
      const out = decorPlacements(
        input(w, 1, (_t, decor) => {
          decor[TWIN_Y * w + TWIN_X] = DECOR_GROVE;
        })
      );
      const trees = out.filter((p) => p.family === 'tree');
      expect(trees.length).toBe(2);
      expect(trees[1].scale).toBeCloseTo(trees[0].scale * 0.68, 6);
    });

    it('the twin does not sit exactly on top of the first tree', () => {
      const w = TWIN_X + 1;
      const out = decorPlacements(
        input(w, 1, (_t, decor) => {
          decor[TWIN_Y * w + TWIN_X] = DECOR_GROVE;
        })
      );
      const trees = out.filter((p) => p.family === 'tree');
      expect(trees[0].x === trees[1].x && trees[0].z === trees[1].z).toBe(false);
    });

    it('both twin trees stay inside their own tile footprint', () => {
      const w = TWIN_X + 1;
      const out = decorPlacements(
        input(w, 1, (_t, decor) => {
          decor[TWIN_Y * w + TWIN_X] = DECOR_GROVE;
        })
      );
      for (const p of out.filter((t) => t.family === 'tree')) {
        expect(p.x).toBeGreaterThanOrEqual(TWIN_X);
        expect(p.x).toBeLessThanOrEqual(TWIN_X + 1);
        expect(p.z).toBeGreaterThanOrEqual(TWIN_Y);
        expect(p.z).toBeLessThanOrEqual(TWIN_Y + 1);
      }
    });

    it('is deterministic across two runs, twin included', () => {
      const w = TWIN_X + 1;
      const build = (): TerrainInput =>
        input(w, 1, (_t, decor) => {
          decor[TWIN_Y * w + TWIN_X] = DECOR_GROVE;
        });
      expect(decorPlacements(build())).toEqual(decorPlacements(build()));
    });
  });

  describe('boulder tiles (T1-C: the field a vehicle cannot cross must actually draw)', () => {
    it('a map with no boulder layer at all places no boulders', () => {
      // The field is optional (`boulder?: Uint8Array | null`) -- omitting it
      // entirely, the way every non-boulder test in this file already does
      // via `input()`, must read as "no boulders", not a crash.
      const out = decorPlacements(input(8, 8));
      expect(out.some((p) => p.family === 'boulder')).toBe(false);
    });

    it('a boulder tile gets a boulder, not grass or sand', () => {
      // Before this: a `b` tile has blocked=0/decor=none/cover=0 (map.ts's
      // own legend), which is EXACTLY the shape `familyFor` already reads as
      // "roll grass or sand" -- the bug this task exists to fix. A boulder
      // tile is open ground to `decorPlacements`'s other inputs, so this
      // proves the boulder mask itself is what redirects it.
      const boulder = new Uint8Array(4);
      boulder[0] = 1; // tile (0,0) of a 2x2 map
      const out = decorPlacements(inputWithBoulder(2, 2, boulder));
      const atOrigin = out.filter((p) => p.x >= 0 && p.x <= 1 && p.z >= 0 && p.z <= 1);
      expect(atOrigin.length).toBeGreaterThan(0);
      for (const p of atOrigin) expect(p.family).toBe('boulder');
    });

    it('places on EVERY boulder tile -- a field, not a sparse roll', () => {
      // "Noticeably denser than rock" (rock's own DENSITY is 0.75, a roll
      // that skips some qualifying tiles): boulder tiles must place
      // unconditionally, or the field reads with holes a vehicle could
      // thread through.
      const boulder = new Uint8Array(20 * 20).fill(1);
      const out = decorPlacements(inputWithBoulder(20, 20, boulder));
      const boulders = out.filter((p) => p.family === 'boulder');
      expect(boulders.length).toBe(20 * 20);
    });

    it('is denser than the rock family on an otherwise-identical roll', () => {
      // Direct A/B on the SAME density gate: a knoll tile (family 'rock')
      // rolls against DENSITY.rock (0.75) and can come up empty; the boulder
      // tile at the same map position, same hash stream, must not.
      const knollOut = decorPlacements(
        input(20, 20, (_t, decor) => decor.fill(3 /* DECOR_KNOLL, shared.ts */))
      );
      const boulder = new Uint8Array(20 * 20).fill(1);
      const boulderOut = decorPlacements(inputWithBoulder(20, 20, boulder));
      const knollCount = knollOut.filter((p) => p.family === 'rock').length;
      const boulderCount = boulderOut.filter((p) => p.family === 'boulder').length;
      expect(boulderCount).toBeGreaterThan(knollCount);
      expect(boulderCount).toBe(400); // every tile, unconditionally
    });

    it('is deterministic across two runs', () => {
      const boulder = new Uint8Array(10 * 10);
      for (let i = 0; i < boulder.length; i++) boulder[i] = i % 3 === 0 ? 1 : 0;
      const a = decorPlacements(inputWithBoulder(10, 10, boulder));
      const b = decorPlacements(inputWithBoulder(10, 10, boulder));
      expect(a).toEqual(b);
    });

    it('sits on its own tile\'s elevation, like every other family', () => {
      const boulder = new Uint8Array(4);
      boulder[0] = 1;
      const raised: TerrainInput = { ...inputWithBoulder(2, 2, boulder), elevation: new Uint8Array(4).fill(3) };
      const out = decorPlacements(raised);
      const b = out.find((p) => p.family === 'boulder');
      expect(b?.y).toBe(3 * WORLD_PER_LEVEL);
    });
  });

  it('rolls density on its own stream, independent of scatter.ts\'s ground-grain roll', () => {
    // scatter.ts's own ground grain treats bare `tileHash(x, y)` as its
    // pebble/fleck gate (`rnd > 0.9`, `rnd > 0.84`). Tile (28, 0) on an
    // all-open map rolls tileHash(28, 0) = 0.9269 -- squarely in that
    // "pebbled" range -- and its family roll (the offset stream at
    // (x+977, y+311)) picks 'grass' (density 0.34). If this module's density
    // gate reused that same bare `tileHash(x, y)` -- which the module's own
    // doc comment says it must NOT do -- this tile could never get a grass
    // tuft: 0.9269 >= 0.34 fails the gate on every run, deterministically,
    // not merely on average, because 0.34 and >0.9 never overlap for any
    // family this dense or sparser (grass 0.34, sand 0.18, bush <=1). This
    // exact tile was chosen (by scanning tileHash directly) because it ALSO
    // clears an independent density stream, so it is expected to place once
    // the two streams are actually decoupled.
    const out = decorPlacements(input(40, 40));
    const jx = tileHash(28 + 101, 0 + 7) - 0.5;
    const jy = tileHash(28 + 13, 0 + 401) - 0.5;
    const expectedX = 28 + 0.5 + jx * 0.6;
    const expectedZ = 0 + 0.5 + jy * 0.6;
    const hit = out.find(
      (p) => Math.abs(p.x - expectedX) < 1e-9 && Math.abs(p.z - expectedZ) < 1e-9
    );
    expect(hit?.family).toBe('grass');
  });
});
