import { describe, it, expect } from 'vitest';
import {
  BUSH_COVER_BASE,
  CLUSTER_R_MAX,
  decorPlacements,
  DITCH_LIFT,
  GRASS_SCALE_MAX,
  GRASS_SCALE_MIN,
  isOpenScatterAt,
  SCATTER_DENSITY,
  SCATTER_ROAD_CLEAR,
  VARIANTS_PER_FAMILY,
  type DecorPlacement,
} from './decor-place';
import { buildRoadGraph, roadDistanceAt } from './road-graph';
import {
  DECOR_DITCH,
  DECOR_GROVE,
  DECOR_KNOLL,
  DECOR_RIDGE,
  DECOR_ROAD,
  WORLD_PER_LEVEL,
} from './shared';
import { tileHash } from '../../tile-hash';
import type { TerrainInput } from './types';
import type { OpenScatter } from '../../api';

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
    expect(families(DECOR_GROVE)).toEqual(new Set(['desert_tree']));
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
      expect(out[0].family).toBe('desert_tree');
    });

    it('places two trees above the threshold, the second at 0.68 the first\'s scale', () => {
      const w = TWIN_X + 1;
      const out = decorPlacements(
        input(w, 1, (_t, decor) => {
          decor[TWIN_Y * w + TWIN_X] = DECOR_GROVE;
        })
      );
      const trees = out.filter((p) => p.family === 'desert_tree');
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
      const trees = out.filter((p) => p.family === 'desert_tree');
      expect(trees[0].x === trees[1].x && trees[0].z === trees[1].z).toBe(false);
    });

    it('both twin trees stay inside their own tile footprint', () => {
      const w = TWIN_X + 1;
      const out = decorPlacements(
        input(w, 1, (_t, decor) => {
          decor[TWIN_Y * w + TWIN_X] = DECOR_GROVE;
        })
      );
      for (const p of out.filter((t) => t.family === 'desert_tree')) {
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

  // Restored regression guard (ground plan 2 review, Task 1 fix round 1):
  // the pre-G8 version of this test pinned the exact per-tile jitter formula
  // as the ONLY way a grass/sand object was placed, which G8's clustering
  // pass retired for grass/sand generally (a member can now drift onto a
  // tile from a NEIGHBOURING tile's cluster, so a tile's exact hit can no
  // longer be predicted from its own formula alone in general). What
  // SURVIVES unchanged is the SINGLETON roll specifically -- "a singleton
  // lands where an object used to" -- which still gates on the tile's own
  // old stream (449/823) and still places at the tile's own old jitter
  // formula (101/7, 13/401). This re-targets the same guard at that one
  // still-deterministic mechanism.
  it('gates the singleton on its OWN stream (449/823), not the bare tileHash(x, y) scatter.ts\'s ground grain uses', () => {
    // scatter.ts's own ground grain treats bare `tileHash(x, y)` as its
    // pebble/fleck gate (`rnd > 0.9`, `rnd > 0.84`). Tile (28, 0) on an
    // all-open map rolls tileHash(28, 0) = 0.9269 -- squarely "pebbled" --
    // while its OWN singleton stream (449/823) rolls 0.0173, comfortably
    // under `SINGLETON_P` (0.19), and its family stream (977/311) picks
    // 'grass'. If the singleton gate reused that same bare `tileHash(x, y)`
    // -- which the module's own header comment says it must NOT do -- this
    // tile could never get a singleton: 0.9269 >= 0.19 fails on every run,
    // deterministically, not merely on average, because 0.19 and 0.93 never
    // overlap. This exact tile is the one the pre-G8 version of this test
    // used, because both streams it depends on (449/823, 977/311) are
    // unchanged by G8 -- only `SINGLETON_P`'s own value moved, and 0.0173
    // clears it with room to spare.
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

/**
 * A w*h map with a ditch drawn by a callback. Ditch tiles set BOTH layers,
 * exactly as `map.ts`'s legend does for `d`: the decor kind AND the
 * vehicle-only mask. A fixture that set only one of them would be testing a
 * map the parser cannot produce -- and setting only `decor` would let the
 * ditch-before-boulder ordering test below pass for the wrong reason.
 */
function ditchInput(w: number, h: number, mark: (x: number, y: number) => boolean): TerrainInput {
  const decor = new Uint8Array(w * h);
  const boulder = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mark(x, y)) continue;
      decor[y * w + x] = DECOR_DITCH;
      boulder[y * w + x] = 1;
    }
  }
  return {
    width: w,
    height: h,
    decor,
    elevation: null,
    blocked: new Uint8Array(w * h),
    cover: new Uint8Array(w * h),
    boulder,
  };
}

const ditchOnly = (out: readonly DecorPlacement[]): DecorPlacement[] =>
  out.filter((p) => p.family === 'ditch');

describe('an anti-tank ditch (`d`)', () => {
  it('draws a ditch, not boulders, on a tile that sets both layers', () => {
    // The ordering guard. A `d` tile sets the boulder mask too -- the two
    // symbols deliberately share one vehicle-only mask -- so if `familyFor`
    // tested `boulder` first, every ditch tile on every map would draw a
    // field of rocks and no ditch would exist anywhere.
    const out = decorPlacements(ditchInput(9, 9, (x, y) => y === 4 && x >= 2 && x <= 6));
    expect(ditchOnly(out).length).toBe(5);
    expect(out.some((p) => p.family === 'boulder')).toBe(false);
  });

  it('places exactly one segment per tile of a straight run, on the tile centre', () => {
    // One per tile with no jitter is what makes a run continuous: the segment
    // is baked to exactly one tile of length, so centring it spans [x, x+1]
    // and abuts its neighbours with no gap and no overlap. Any jitter here
    // would open a hole in an obstacle the player reads to decide whether
    // armour can pass.
    const out = ditchOnly(decorPlacements(ditchInput(9, 9, (x, y) => y === 4 && x >= 2 && x <= 6)));
    expect(out.map((p) => [p.x, p.z])).toEqual([
      [2.5, 4.5],
      [3.5, 4.5],
      [4.5, 4.5],
      [5.5, 4.5],
      [6.5, 4.5],
    ]);
  });

  it('gives every segment the same scale and variant — no rolls at all', () => {
    const out = ditchOnly(decorPlacements(ditchInput(9, 9, (x, y) => y === 4 && x >= 2 && x <= 6)));
    expect(new Set(out.map((p) => p.scale))).toEqual(new Set([1]));
    expect(new Set(out.map((p) => p.variant))).toEqual(new Set([0]));
    // Variant 0 specifically, not merely "all the same": only `ditch_0.glb`
    // exists, and a rolled 1 or 2 would hit `buildTexturedDecorMesh`'s
    // missing-key skip and erase that tile's obstacle.
    expect(out.every((p) => p.variant === 0)).toBe(true);
  });

  it('runs the trench along the run: 0 turns east-west, a quarter turn north-south', () => {
    const ew = ditchOnly(decorPlacements(ditchInput(9, 9, (x, y) => y === 4 && x >= 2 && x <= 6)));
    expect(new Set(ew.map((p) => p.yawTurns))).toEqual(new Set([0]));
    const ns = ditchOnly(decorPlacements(ditchInput(9, 9, (x, y) => x === 4 && y >= 2 && y <= 6)));
    expect(new Set(ns.map((p) => p.yawTurns))).toEqual(new Set([0.25]));
  });

  it('draws BOTH axes at a corner, so a bend is a crossing and never a hole', () => {
    // The asset is a straight prismatic segment and cannot express a bend, so
    // a corner is either a gap or a crossing. This picks the crossing on
    // purpose: a gap draws ground a vehicle visibly could drive through on
    // tiles `blockedVehicle` says are impassable. The corner tile is the only
    // one carrying two segments; both arms' straight tiles carry one.
    const out = ditchOnly(
      decorPlacements(
        // An L: east arm along y=4, south arm down x=6.
        ditchInput(9, 9, (x, y) => (y === 4 && x >= 2 && x <= 6) || (x === 6 && y >= 4 && y <= 7))
      )
    );
    const at = (x: number, y: number): number[] =>
      out.filter((p) => p.x === x + 0.5 && p.z === y + 0.5).map((p) => p.yawTurns).sort();
    expect(at(6, 4)).toEqual([0, 0.25]); // the corner itself
    expect(at(4, 4)).toEqual([0]); // mid east arm
    expect(at(6, 6)).toEqual([0.25]); // mid south arm
  });

  it('draws both axes at a T-junction too', () => {
    const out = ditchOnly(
      decorPlacements(ditchInput(9, 9, (x, y) => (y === 4 && x >= 2 && x <= 6) || (x === 4 && y >= 4 && y <= 7)))
    );
    const at = (x: number, y: number): number[] =>
      out.filter((p) => p.x === x + 0.5 && p.z === y + 0.5).map((p) => p.yawTurns).sort();
    expect(at(4, 4)).toEqual([0, 0.25]);
  });

  it('gives an isolated tile one segment, deterministically along x', () => {
    // Arbitrary but FIXED. Rolling tileHash here would make a run's first
    // authored tile flip axis the moment a second was authored beside it.
    const out = ditchOnly(decorPlacements(ditchInput(9, 9, (x, y) => x === 4 && y === 4)));
    expect(out.length).toBe(1);
    expect(out[0].yawTurns).toBe(0);
  });

  it('does not let a neighbouring boulder field bend the run', () => {
    // `isDitch` reads the DECOR layer, not the shared vehicle mask. A boulder
    // beside a ditch sets the same mask bit, and asking that question here
    // would turn a straight ditch into a junction because of a rock next door.
    const w = 9;
    const t = ditchInput(w, 9, (x, y) => y === 4 && x >= 2 && x <= 6);
    t.boulder![3 * w + 4] = 1; // a boulder directly north of a ditch tile
    const at4 = ditchOnly(decorPlacements(t)).filter((p) => p.x === 4.5 && p.z === 4.5);
    expect(at4.map((p) => p.yawTurns)).toEqual([0]);
  });

  it('lifts the apron clear of the terrain it replaces', () => {
    // The GLB grounds its apron at exactly Z=0, which would be coplanar with
    // the terrain plane and z-fight across a fifth of the segment's width.
    const flat = ditchOnly(decorPlacements(ditchInput(9, 9, (x, y) => y === 4 && x >= 2 && x <= 6)));
    expect(flat.every((p) => p.y === DITCH_LIFT)).toBe(true);
    expect(DITCH_LIFT).toBeGreaterThan(0);
    // And it is an epsilon, not a step: well under a single elevation level,
    // so it can never read as the ditch sitting on a plinth.
    expect(DITCH_LIFT).toBeLessThan(WORLD_PER_LEVEL / 10);
  });

  it('stacks that lift on the tile’s own elevation, like every other family', () => {
    const w = 9;
    const t = ditchInput(w, 9, (x, y) => y === 4 && x >= 2 && x <= 6);
    const elevation = new Uint8Array(w * 9);
    elevation[4 * w + 4] = 3;
    t.elevation = elevation;
    const at4 = ditchOnly(decorPlacements(t)).filter((p) => p.x === 4.5 && p.z === 4.5);
    expect(at4[0].y).toBeCloseTo(3 * WORLD_PER_LEVEL + DITCH_LIFT, 10);
  });

  it('never skips a tile — density is 1.0 and a gap is a gameplay lie', () => {
    // Every other family rolls against a density and legitimately leaves
    // tiles bare. A ditch that did would draw a hole a vehicle could see
    // through, on ground it cannot cross.
    const w = 24;
    const out = ditchOnly(decorPlacements(ditchInput(w, 24, (_x, y) => y === 12)));
    expect(out.length).toBe(w);
    expect(new Set(out.map((p) => p.x))).toEqual(new Set(Array.from({ length: w }, (_, i) => i + 0.5)));
  });
});

describe('the grove species follows the map theme', () => {
  // The lead, 2026-09-07: "using olive tree does not fit the desert terrain."
  // `TerrainTones.groveFamily` is the switch; these three pin both ends of it
  // and the default, because the default is what every fixture in this file
  // and every map with no `terrain` key gets.
  const groveOnly = (groveFamily?: 'tree' | 'desert_tree'): Set<string> => {
    const out = decorPlacements({
      ...input(1, 1, (_t, decor) => {
        decor[0] = DECOR_GROVE;
      }),
      ...(groveFamily === undefined ? {} : { groveFamily }),
    });
    return new Set(out.map((p) => p.family));
  };

  it('draws the olive on a green map', () => {
    expect(groveOnly('tree')).toEqual(new Set(['tree']));
  });

  it('draws the desert tree on an arid one', () => {
    expect(groveOnly('desert_tree')).toEqual(new Set(['desert_tree']));
  });

  it('defaults to the desert tree, because map.schema.json defaults terrain to arid', () => {
    // The safe default in both directions: a caller that forgets to thread
    // the theme puts a desert tree on a desert map, never an olive.
    expect(groveOnly()).toEqual(new Set(['desert_tree']));
  });
});

const openObjects = (ps: readonly DecorPlacement[]): DecorPlacement[] =>
  ps.filter((p) => p.family === 'grass' || p.family === 'sand');

/** Clark-Evans ratio: mean nearest-neighbour distance over the value a
 *  uniform (Poisson) scatter of the same density would give, 0.5 / sqrt(n / A).
 *  About 1 for an even spread, well under 1 for clumps. */
function clarkEvans(ps: readonly DecorPlacement[], area: number): number {
  let sum = 0;
  for (const p of ps) {
    let best = Infinity;
    for (const q of ps) {
      if (q === p) continue;
      const d = Math.hypot(p.x - q.x, p.z - q.z);
      if (d < best) best = d;
    }
    sum += best;
  }
  return sum / ps.length / (0.5 / Math.sqrt(ps.length / area));
}

/** Ripley's K statistic at radius `r` (tiles), normalised by `πr²` so a
 *  Poisson (uniform) scatter reads ~1 and clustering reads above it -- no
 *  edge correction, matching this fixture's own interior-heavy density. A
 *  SECOND, density-independent clumping metric alongside Clark-Evans: K
 *  counts how many OTHER points fall within `r` of each point (Clark-Evans
 *  only asks about the SINGLE nearest one), so the two can disagree on a
 *  pattern where CE's own small-sample noise or edge loss moves it around. */
function ripleyK(ps: readonly DecorPlacement[], area: number, r: number): number {
  let count = 0;
  for (const p of ps) {
    for (const q of ps) {
      if (q === p) continue;
      if (Math.hypot(p.x - q.x, p.z - q.z) <= r) count++;
    }
  }
  const n = ps.length;
  return (area / (n * n)) * count / (Math.PI * r * r);
}

describe('clustered grass and sand (spec §3.4, N-1)', () => {
  const open = input(48, 48);
  // Dial 1 (the shipped default): the density-band claim (N-1's "0.9 an
  // open tile") and Ripley's K are both measured HERE, because K(1 tile) is
  // itself a density-scaled COUNT (how many neighbours fall within a tile)
  // and its own >1.4 floor was measured at this rate.
  // Dial 1 explicitly: N-1's band and the clump shape are the UNSHED rule.
  // The shipped default is the lead's shed (0.75, 2026-09-28), pinned below.
  const placed = openObjects(decorPlacements(open, 1));
  // Dial 0.3 (the shed dial, spec §8, N-22 -- scales seed/singleton
  // probability only, NEVER cluster radius, member count or family split):
  // Clark-Evans and the family-agreement check below are measured at a
  // LOWER dial on purpose. Both ask about a point's nearest neighbour(s)
  // relative to the OTHER points nearby, so as more, denser clusters start
  // to overlap each other (dial 1 measures 0.825/0.807 -- see Finding 1's
  // plan-instrument note below), a point's nearest neighbour is
  // increasingly likely to belong to a DIFFERENT clump rather than its own,
  // which is a property of how CROWDED the map is, not of whether any one
  // clump is clumped. The clump geometry itself (radius, member count,
  // family-per-clump) is IDENTICAL at every dial -- only how many clumps
  // exist changes -- so a lower, less crowded dial isolates the geometry
  // the brief's 0.7/0.85 thresholds were actually written to check.
  const placedLow = openObjects(decorPlacements(open, 0.3));

  // Raw here is 0.114 x 8 + 0.19 = 1.102; R-3 (road clearance) plus this
  // fixture's own edge loss bring it to 0.947. See `CLUSTER_SEED_P`'s own
  // doc comment in decor-place.ts for the lead-approved derivation.
  it('carries 0.8-0.95 objects an open tile on an all-open map (0.114 x 8 + 0.19 = 1.102 raw)', () => {
    const perTile = placed.length / (48 * 48);
    expect(perTile).toBeGreaterThan(0.8);
    expect(perTile).toBeLessThan(0.95);
  });
  // Finding 1 (ground plan 2 review, Task 1 fix round 1): the brief's own
  // 0.7 threshold was ALREADY unreachable at the brief's OWN approved
  // 0.09/0.15 rate -- measured at 0.798 there, before this file ever raised
  // the density. That is a plan-instrument finding, not an effect of the
  // later raise: measuring clumping SHAPE at dial 1, where the absolute
  // cluster count is high enough for clumps to start overlapping each
  // other, conflates "are clumps tight" with "how many clumps are there".
  // Measured at dial 0.3, where that crowding does not yet happen, CE reads
  // 0.659 -- comfortably under the brief's own 0.7, at BOTH density rates
  // (0.09/0.15 and 0.114/0.19 alike, since the shed dial does not touch
  // clump radius or member count). This is the corrected instrument, not a
  // loosened threshold: the brief's own number, on a fixture that isolates
  // what it was meant to measure.
  it('is clumped: Clark-Evans ratio under 0.7 (measured density-invariantly, at dial 0.3)', () => {
    expect(clarkEvans(placedLow, 48 * 48)).toBeLessThan(0.7);
  });
  // Ripley's K is the density-band's OWN partner metric, deliberately kept
  // at dial 1 rather than 0.3: K(r)/πr² is itself a count of how many
  // neighbours fall within `r`, so it is meant to read differently as
  // density changes, and 1.4 is calibrated against the shipped rate (1.71
  // measured here) against a uniform scatter's ~1.0 (0.97, falsification
  // (a) below). Clark-Evans and Ripley's K measure different things (one
  // point's single nearest neighbour vs. every point's whole neighbourhood
  // within a radius) and are deliberately measured at different dials for
  // that reason -- neither is a substitute for the other.
  it("Ripley's K at 1 tile shows clustering at the shipped rate: K(1)/πr² over 1.4", () => {
    expect(ripleyK(placed, 48 * 48, 1)).toBeGreaterThan(1.4);
  });
  it('gives every member of a clump its seed tile family (N-2), measured density-invariantly at dial 0.3', () => {
    // Each object's nearest neighbour is almost always in its own clump, so
    // nearest-neighbour pairs closer than CLUSTER_R_MAX agree on family.
    // Same density-invariant measurement as Clark-Evans above, for the same
    // reason: at dial 1 (0.807, ALREADY under the brief's 0.85 at the
    // brief's own 0.09/0.15 rate -- 0.842 there, again a plan-instrument
    // finding rather than an effect of the raise) a nearest neighbour is
    // more often a DIFFERENT nearby clump's member simply because more
    // clumps exist to be near. At dial 0.3, clumps are sparse enough that
    // this reads 0.909 -- comfortably over the brief's own 0.85.
    let agree = 0;
    let total = 0;
    for (const p of placedLow) {
      const q = placedLow
        .filter((o) => o !== p)
        .reduce((a, b) => (Math.hypot(a.x - p.x, a.z - p.z) < Math.hypot(b.x - p.x, b.z - p.z) ? a : b));
      if (Math.hypot(q.x - p.x, q.z - p.z) > CLUSTER_R_MAX) continue;
      total++;
      if (q.family === p.family) agree++;
    }
    expect(agree / total).toBeGreaterThan(0.85);
  });
  it('keeps grass inside N-4 scales, and sand at its old 0.8-1.2', () => {
    for (const p of placed) {
      if (p.family === 'grass') {
        expect(p.scale).toBeGreaterThanOrEqual(GRASS_SCALE_MIN);
        expect(p.scale).toBeLessThanOrEqual(GRASS_SCALE_MAX);
      } else {
        expect(p.scale).toBeGreaterThanOrEqual(0.8);
        expect(p.scale).toBeLessThanOrEqual(1.2);
      }
    }
  });
  it('is deterministic', () => {
    expect(decorPlacements(open)).toEqual(decorPlacements(open));
  });
});

describe('where a member may land (N-3, R-3)', () => {
  const roadRow = input(48, 48, (_i, decor) => {
    for (let x = 0; x < 48; x++) decor[20 * 48 + x] = DECOR_ROAD;
  });
  const graph = buildRoadGraph(roadRow);

  it('never within SCATTER_ROAD_CLEAR of a road centreline', () => {
    for (const p of openObjects(decorPlacements(roadRow))) {
      expect(roadDistanceAt(graph, p.x, p.z), `(${p.x}, ${p.z})`).toBeGreaterThanOrEqual(SCATTER_ROAD_CLEAR);
    }
  });
  it('never on a blocked, cover, grove, knoll, ridge, ditch or boulder tile', () => {
    // Seven tile classes in rotation; only class 6 is open ground.
    const n = 24 * 24;
    const decor = new Uint8Array(n);
    const blocked = new Uint8Array(n);
    const cover = new Uint8Array(n);
    const boulder = new Uint8Array(n);
    for (let t = 0; t < n; t++) {
      const k = t % 7;
      if (k === 0) blocked[t] = 1;
      else if (k === 1) cover[t] = 2;
      else if (k === 2) decor[t] = DECOR_GROVE;
      else if (k === 3) decor[t] = DECOR_KNOLL;
      else if (k === 4) decor[t] = DECOR_DITCH;
      else if (k === 5) boulder[t] = 1;
    }
    const mixed: TerrainInput = { width: 24, height: 24, decor, elevation: null, blocked, cover, boulder };
    const g = buildRoadGraph(mixed);
    for (const p of openObjects(decorPlacements(mixed))) {
      expect(isOpenScatterAt(mixed, g, p.x, p.z), `(${p.x}, ${p.z})`).toBe(true);
      const t = Math.floor(p.z) * 24 + Math.floor(p.x);
      expect(t % 7 === 6, `(${p.x}, ${p.z}) is on tile class ${t % 7}`).toBe(true);
    }
  });
  it('never off the map', () => {
    for (const p of openObjects(decorPlacements(input(12, 12)))) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThan(12);
      expect(p.z).toBeGreaterThanOrEqual(0);
      expect(p.z).toBeLessThan(12);
    }
  });
});

describe('bush on cover doubles (N-5)', () => {
  it.each([
    [1, 0.6],
    [2, 0.9],
    [3, 1.0],
  ])('cover %i carries a bush on about %f of its tiles', (c, want) => {
    const m = input(48, 48, (_i, _d, _b, cover) => cover.fill(c));
    const bushes = decorPlacements(m).filter((p) => p.family === 'bush').length;
    expect(Math.abs(bushes / (48 * 48) - want)).toBeLessThan(0.05);
    expect(BUSH_COVER_BASE).toBe(0.6);
  });
});

describe('the density dial (R-4, N-22)', () => {
  it('ships at 0.75, the lead\'s shed (2026-09-28): a quarter fewer open-ground objects than dial 1', () => {
    // Task 5 measured beit_sahwan_outskirts (22,24) z0.5 at +1.18 ms gpu p95
    // over main at dial 1, against a +0.74 budget; the lead chose the ladder's
    // first rung. The default is the shipped number, so it is pinned.
    expect(SCATTER_DENSITY).toBe(0.75);
    const m = input(48, 48);
    const ratio = openObjects(decorPlacements(m)).length / openObjects(decorPlacements(m, 1)).length;
    expect(ratio).toBeGreaterThan(0.69);
    expect(ratio).toBeLessThan(0.81);
  });

  it('halves open-ground objects at 0.5 and leaves every other family alone', () => {
    const m = input(48, 48, (_i, decor, _b, cover) => {
      for (let t = 0; t < 48 * 48; t += 5) decor[t] = DECOR_GROVE;
      for (let t = 2; t < 48 * 48; t += 11) cover[t] = 1;
    });
    const full = decorPlacements(m, 1);
    const half = decorPlacements(m, 0.5);
    const ratio = openObjects(half).length / openObjects(full).length;
    expect(ratio).toBeGreaterThan(0.44);
    expect(ratio).toBeLessThan(0.56);
    const rest = (ps: readonly DecorPlacement[]) => ps.filter((p) => p.family !== 'grass' && p.family !== 'sand');
    expect(rest(half)).toEqual(rest(full));
  });
});

// -- GH-322: the highland's open-ground pass and cedar groves ------------
describe('openScatter (GH-322)', () => {
  const HIGHLAND: OpenScatter = {
    tree: 'cedar',
    treePlain: 0.008,
    treeFoothill: 0.035,
    boulderPlain: 0.015,
    boulderFoothill: 0.05,
    bush: 0.05,
    chipPlain: 0.12,
    chipFoothill: 0.2,
    chipCluster: 0.5,
    sandKeep: 0,
  };
  /** 40x40 open ground with a ridge row across the middle and a road column
   *  down x=5 -- relief for the foothill bands, a road for the clearance. */
  const map = (extra?: OpenScatter, grove?: 'tree' | 'cedar'): TerrainInput =>
    input(40, 40, (i, decor, blocked) => {
      for (let x = 0; x < 40; x++) {
        decor[20 * 40 + x] = DECOR_RIDGE;
        blocked[20 * 40 + x] = 1;
      }
      for (let y = 0; y < 40; y++) decor[y * 40 + 5] = DECOR_ROAD;
      for (let x = 30; x < 34; x++) decor[2 * 40 + x] = DECOR_GROVE;
      i.openScatter = extra;
      i.groveFamily = grove;
    });
  const count = (ps: readonly DecorPlacement[], f: string): number => ps.filter((p) => p.family === f).length;

  it('places exactly what it placed before when the theme declares none', () => {
    const before = decorPlacements(map());
    // The same input object with the field present but undefined is the
    // arid/green case as `composeTerrain` builds it.
    expect(decorPlacements(map(undefined))).toEqual(before);
    expect(count(before, 'cedar')).toBe(0);
    expect(count(before, 'sand')).toBeGreaterThan(0);
  });

  it('adds cedars, outcrops, bushes and chips, and keeps every placement the passes before it made', () => {
    const before = decorPlacements(map());
    const after = decorPlacements(map({ ...HIGHLAND, sandKeep: 1 }));
    // sandKeep 1: nothing dropped, so the old list is a strict prefix.
    expect(after.slice(0, before.length)).toEqual(before);
    for (const f of ['cedar', 'boulder', 'bush', 'rock']) expect(count(after, f), f).toBeGreaterThan(0);
  });

  it('drops every sand tuft at sandKeep 0 and leaves the grass alone', () => {
    const before = decorPlacements(map());
    const after = decorPlacements(map(HIGHLAND));
    expect(count(after, 'sand')).toBe(0);
    expect(count(after, 'grass')).toBe(count(before, 'grass'));
  });

  it('grows cedars denser on the foothill than on the plain', () => {
    const ps = decorPlacements(map({ ...HIGHLAND, treePlain: 0.05, treeFoothill: 0.5 })).filter((p) => p.family === 'cedar');
    const foot = ps.filter((p) => Math.abs(Math.floor(p.z) - 20) <= 2).length;
    // Foothill rows are 4 of the 39 open rows (18, 19, 21, 22).
    expect(foot / 4).toBeGreaterThan((ps.length - foot) / 35);
  });

  it('keeps every open-ground object at least a tile off the road', () => {
    const ps = decorPlacements(map({ ...HIGHLAND, treePlain: 0.3, boulderPlain: 0.3, bush: 0.2, chipPlain: 0.2 }));
    const added = ps.filter((p) => ['cedar', 'boulder', 'bush'].includes(p.family));
    expect(added.length).toBeGreaterThan(0);
    for (const p of added) expect(Math.abs(Math.floor(p.x) - 5), JSON.stringify(p)).toBeGreaterThan(1);
  });

  it('plants the open-ground species independently of the grove species', () => {
    const ps = decorPlacements(map(HIGHLAND, 'tree'));
    // Umm Zeitoun's case: olives on the grove tiles, cedars on the hill.
    const onGrove = ps.filter((p) => Math.floor(p.z) === 2 && Math.floor(p.x) >= 30 && Math.floor(p.x) < 34);
    expect(onGrove.length).toBeGreaterThan(0);
    expect(onGrove.every((p) => p.family === 'tree' || p.family === 'grass')).toBe(true);
    expect(count(ps, 'cedar')).toBeGreaterThan(0);
  });

  it('never twins a cedar grove tile, and rolls it at 0.6', () => {
    const grove = input(30, 30, (i, decor) => {
      decor.fill(DECOR_GROVE);
      i.groveFamily = 'cedar';
    });
    const trees = decorPlacements(grove).filter((p) => p.family === 'cedar');
    let expected = 0;
    for (let y = 0; y < 30; y++) for (let x = 0; x < 30; x++) if (tileHash(x + 449, y + 823) < 0.6) expected++;
    expect(trees.length).toBe(expected);
    expect(trees.every((p) => p.scale >= 0.8)).toBe(true);
  });
});
